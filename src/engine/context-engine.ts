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

  private config!: RecursiveClawConfig;
  private storage!: SQLiteStorage;
  private retrieval!: RetrievalEngine;
  private subQueryEngine!: SubQueryEngine;
  private costTracker!: CostTracker;
  private assembler!: Assembler;
  private api: OpenClawPluginAPI | null;
  private pluginConfig: Record<string, unknown>;

  constructor(api: OpenClawPluginAPI | null, pluginConfig?: Record<string, unknown>) {
    this.api = api;
    this.pluginConfig = pluginConfig ?? {};
  }

  async bootstrap(): Promise<void> {
    // 1. Resolve config
    this.config = resolveConfig(this.pluginConfig);

    // 2. Initialize storage
    const dbPath = this.config.databasePath || join(process.cwd(), '.recursive-claw', 'context.db');

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
    this.retrieval.setSubQueryFn((question, opts) => this.subQueryEngine.query(question, opts));

    // 5. Create assembler
    this.assembler = new Assembler(this.storage, this.config);

    // 6. Register tools if in tools mode
    if (this.config.mode === 'tools' && this.api) {
      registerTools(this.api, this.retrieval);
    }
  }

  async ingest(params: IngestParams): Promise<void> {
    const { sessionId, message, isHeartbeat } = params;
    if (isHeartbeat) return;

    await this.storage.ensureSession(sessionId);
    this.retrieval.setCurrentSession(sessionId);

    const messageIndex = await this.storage.getNextMessageIndex(sessionId);
    const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);

    await this.storage.storeMessage({
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
    const { sessionId, messages } = params;
    this.retrieval.setCurrentSession(sessionId);

    const systemMessages = messages.filter(m => m.role === 'system');
    return this.assembler.assemble(sessionId, systemMessages);
  }

  async compact(params: CompactParams): Promise<CompactResult> {
    // No-op by default — we don't destroy information.
    // Manual /compact triggers index maintenance.
    if (params.force) {
      await this.storage.rebuildFTSIndex();
    }
    return { ok: true, compacted: true };
  }

  async afterTurn(): Promise<void> {
    this.costTracker.resetTurn();
  }

  async prepareSubagentSpawn(): Promise<void> {
    // Child agents get read-only access via same storage. No scoping in v0.1.0.
  }

  async onSubagentEnded(): Promise<void> {
    // Sub-agent results stored via ingest(). No merging in v0.1.0.
  }

  // Accessors for testing
  getStorage(): SQLiteStorage { return this.storage; }
  getRetrieval(): RetrievalEngine { return this.retrieval; }
  getCostTracker(): CostTracker { return this.costTracker; }
  getConfig(): RecursiveClawConfig { return this.config; }
}
