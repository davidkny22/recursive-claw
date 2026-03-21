// ============================================================================
// recursive-claw: All shared types and interfaces
// ============================================================================

// --- Config ---

export type ProviderName = 'anthropic' | 'openai' | 'google' | 'openrouter';
export type EngineMode = 'tools' | 'repl';

export interface ProviderConfig {
  apiKey: string;
  model?: string;
}

export interface SubQueryConfig {
  defaultProvider: ProviderName;
  defaultModel: string;
  providers: Partial<Record<ProviderName, ProviderConfig>>;
  maxBudgetPerQuery: number;
  maxBudgetPerTurn: number;
  maxConcurrent: number;
  maxDepth: number;
  timeout: number;
}

export interface RecursiveClawConfig {
  mode: EngineMode;
  freshTailCount: number;
  databasePath: string;
  subQuery: SubQueryConfig;
}

// --- Storage ---

export interface StoredMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  messageIndex: number;
  tokenEstimate: number;
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  scope?: 'current' | 'all';
  sessionId?: string;
  since?: number;
  before?: number;
  limit?: number;
}

export interface SearchResult {
  message: StoredMessage;
  snippet: string;
  score: number;
}

export interface TimelineEntry {
  period: string;
  messageCount: number;
  tokenCount: number;
  roles: { user: number; assistant: number; tool: number };
  topKeywords: string[];
  messageIndexRange: { start: number; end: number };
  sessionId: string;
}

export interface SessionInfo {
  sessionId: string;
  createdAt: number;
  lastActive: number;
  messageCount: number;
  totalTokens: number;
}

export interface CrossSessionOptions {
  since?: number;
  before?: number;
  limit?: number;
}

// --- Sub-Query ---

export interface MessageRef {
  sessionId: string;
  messageIndex: number;
  timestamp: number;
}

export interface SubQueryResult {
  answer: string;
  sources: MessageRef[];
  confidence: 'high' | 'low';
  tokensUsed: number;
  costUsd: number;
}

export interface SubQueryCompletion {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  cost: number;
}

// --- Context Manifest ---

export interface ContextManifest {
  messageCount: number;
  sessionCount: number;
  timeRange: { earliest: number; latest: number } | null;
  totalTokens: number;
  sessions: SessionInfo[];
  currentSessionId: string;
}

// --- Assembler Output ---

export interface AssembleResult {
  messages: Array<{ role: string; content: unknown }>;
  estimatedTokens: number;
  systemPromptAddition?: string;
}

// --- ContextEngine (OpenClaw plugin interface) ---

export interface ContextEngineInfo {
  id: string;
  name: string;
  ownsCompaction: boolean;
}

export interface IngestParams {
  sessionId: string;
  message: { role: string; content: string; [key: string]: unknown };
  isHeartbeat?: boolean;
}

export interface AssembleParams {
  sessionId: string;
  messages: Array<{ role: string; content: string }>;
  tokenBudget: number;
}

export interface CompactParams {
  sessionId: string;
  force?: boolean;
}

export interface CompactResult {
  ok: boolean;
  compacted: boolean;
}

// --- REPL ---

export interface REPLResult {
  output: string;
  error?: string;
  finalAnswer?: string;
  variables: Record<string, string>;
  executionTimeMs: number;
}

// --- Cost Tracking ---

export interface UsageRecord {
  provider: ProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  timestamp: number;
}

export interface CostSummary {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  callCount: number;
  byProvider: Partial<Record<ProviderName, {
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    callCount: number;
  }>>;
}

// --- OpenClaw Plugin API (type stubs — replaced when SDK types available) ---

export interface OpenClawPluginAPI {
  registerContextEngine(
    id: string,
    factory: (config?: Record<string, unknown>) => ContextEngineInstance
  ): void;
  registerTool(
    tool: ToolDefinition | ((ctx: unknown) => ToolDefinition | ToolDefinition[] | null),
    opts?: { names?: string[]; name?: string; optional?: boolean }
  ): void;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler?: (params: Record<string, unknown>) => Promise<unknown>;
  execute?: (id: string, params: Record<string, unknown>) => Promise<unknown>;
}

export interface ContextEngineInstance {
  info: ContextEngineInfo;
  bootstrap(): Promise<void>;
  ingest(params: IngestParams): Promise<void>;
  assemble(params: AssembleParams): Promise<AssembleResult>;
  compact(params: CompactParams): Promise<CompactResult>;
  afterTurn?(params: { sessionId: string }): Promise<void>;
  prepareSubagentSpawn?(ctx: unknown): Promise<void>;
  onSubagentEnded?(ctx: unknown): Promise<void>;
}
