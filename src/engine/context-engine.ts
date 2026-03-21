import type {
  ContextEngineInstance,
  ContextEngineInfo,
  IngestParams,
  AssembleParams,
  AssembleResult,
  CompactParams,
  CompactResult,
  RecursiveClawConfig,
  OpenClawPluginAPI,
} from '../types.js';
import { SQLiteStorage } from '../storage/sqlite-storage.js';
import { RetrievalEngine } from '../retrieval/retrieval-engine.js';
import { SubQueryEngine } from '../subquery/subquery-engine.js';
import { ProviderRouter } from '../subquery/provider-router.js';
import { CostTracker } from '../subquery/cost-tracker.js';
import { Assembler } from './assembler.js';
import { registerTools } from '../retrieval/tools/tool-registry.js';
import { estimateTokens } from '../token-estimator.js';
import { resolveConfig } from '../config.js';
import { join } from 'path';
import crypto from 'crypto';

export class RecursiveClawEngine implements ContextEngineInstance {
  readonly info: ContextEngineInfo = {
    id: 'recursive-claw',
    name: 'recursive-claw',
    ownsCompaction: true,
  };

  private config: RecursiveClawConfig | null = null;
  private storage: SQLiteStorage | null = null;
  private retrieval: RetrievalEngine | null = null;
  private subQueryEngine: SubQueryEngine | null = null;
  private costTracker: CostTracker | null = null;
  private assembler: Assembler | null = null;
  private api: OpenClawPluginAPI | null;
  private pluginConfig: Record<string, unknown>;
  private bootstrapped = false;

  constructor(api: OpenClawPluginAPI | null, pluginConfig?: Record<string, unknown>) {
    this.api = api;
    this.pluginConfig = pluginConfig ?? {};
    console.log('[recursive-claw] Engine instance created');
  }

  async ensureReady(): Promise<void> {
    return this.ensureBootstrapped();
  }

  private async ensureBootstrapped(): Promise<void> {
    if (!this.bootstrapped) {
      console.log('[recursive-claw] Auto-bootstrapping (bootstrap() not called by host)');
      await this.bootstrap();
    }
  }

  async bootstrap(): Promise<void> {
    if (this.bootstrapped) return;
    console.log('[recursive-claw] bootstrap() called, pluginConfig:', JSON.stringify(this.pluginConfig));

    // 1. Resolve config
    this.config = resolveConfig(this.pluginConfig);
    console.log('[recursive-claw] resolved databasePath:', this.config.databasePath);

    // 2. Initialize storage — use configured path or auto-detect
    // Follow lossless-claw pattern: default to ~/.openclaw/recursive-claw.db
    const home = process.env.HOME || process.env.USERPROFILE || '.';
    const stateDir = process.env.OPENCLAW_STATE_DIR || join(home, '.openclaw');
    const dbPath = this.config.databasePath || join(stateDir, 'recursive-claw.db');
    console.log('[recursive-claw] using database at:', dbPath);

    const { mkdir } = await import('fs/promises');
    const { dirname } = await import('path');
    await mkdir(dirname(dbPath), { recursive: true });

    this.storage = new SQLiteStorage(dbPath);
    await this.storage.initialize();

    // 3. Create retrieval engine
    this.retrieval = new RetrievalEngine(this.storage, 'default');

    // 4. Create sub-query engine
    const router = new ProviderRouter(this.config.subQuery);
    this.costTracker = new CostTracker(
      this.config.subQuery.maxBudgetPerQuery,
      this.config.subQuery.maxBudgetPerTurn
    );
    this.subQueryEngine = new SubQueryEngine(this.retrieval, router, this.costTracker);

    // Wire sub-query into retrieval engine
    this.retrieval.setSubQueryFn((question, opts) => this.subQueryEngine!.query(question, opts));

    // 5. Create assembler
    this.assembler = new Assembler(this.storage, this.config);

    // Tools are registered at plugin load time in plugin.ts, not here

    this.bootstrapped = true;
    console.log('[recursive-claw] bootstrap complete — mode:', this.config.mode);
  }

  async ingest(params: IngestParams): Promise<void> {
    await this.ensureBootstrapped();
    const { sessionId, message, isHeartbeat } = params;
    if (isHeartbeat) return;

    await this.storage!.ensureSession(sessionId);
    this.retrieval!.setCurrentSession(sessionId);

    const messageIndex = await this.storage!.getNextMessageIndex(sessionId);
    const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);

    await this.storage!.storeMessage({
      id: crypto.randomUUID(),
      sessionId,
      role: message.role as 'user' | 'assistant' | 'system' | 'tool',
      content,
      timestamp: Date.now(),
      messageIndex,
      tokenEstimate: estimateTokens(content),
      metadata: message.metadata as Record<string, unknown> | undefined,
    });
  }

  async assemble(params: AssembleParams): Promise<AssembleResult> {
    await this.ensureBootstrapped();
    const { sessionId, messages } = params;
    this.retrieval!.setCurrentSession(sessionId);

    // Store any new messages from the pipeline.
    // OpenClaw passes the full message history in params.messages.
    // We diff against what we already have and store new ones.
    await this.storage!.ensureSession(sessionId);
    const existingCount = await this.storage!.getMessageCount(sessionId);

    if (messages.length > existingCount) {
      const newMessages = messages.slice(existingCount);
      for (let i = 0; i < newMessages.length; i++) {
        const msg = newMessages[i];
        const contentStr = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        await this.storage!.storeMessage({
          id: crypto.randomUUID(),
          sessionId,
          role: msg.role as 'user' | 'assistant' | 'system' | 'tool',
          content: contentStr,
          timestamp: Date.now(),
          messageIndex: existingCount + i,
          tokenEstimate: estimateTokens(contentStr),
          metadata: { originalContent: msg.content },
        });
      }
      console.log(`[recursive-claw] Stored ${newMessages.length} new messages (total: ${messages.length})`);
    }

    const systemMessages = messages.filter(m => m.role === 'system');
    return this.assembler!.assemble(sessionId, systemMessages, messages);
  }

  async compact(params: CompactParams): Promise<CompactResult> {
    await this.ensureBootstrapped();
    if (params.force) {
      await this.storage!.rebuildFTSIndex();
    }
    return { ok: true, compacted: true };
  }

  async afterTurn(): Promise<void> {
    if (this.costTracker) this.costTracker.resetTurn();
  }

  async prepareSubagentSpawn(): Promise<void> {
    // Child agents get read-only access via same storage. No scoping in v0.1.0.
  }

  async onSubagentEnded(): Promise<void> {
    // Sub-agent results stored via ingest(). No merging in v0.1.0.
  }

  // Accessors for testing
  getStorage(): SQLiteStorage { return this.storage!; }
  getRetrieval(): RetrievalEngine { return this.retrieval!; }
  getCostTracker(): CostTracker { return this.costTracker!; }
  getConfig(): RecursiveClawConfig { return this.config!; }
}
