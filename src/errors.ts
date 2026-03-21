export type RCErrorCode =
  | 'STORAGE_ERROR'
  | 'BUDGET_EXCEEDED'
  | 'SUBQUERY_ERROR'
  | 'SANDBOX_TIMEOUT'
  | 'SANDBOX_MEMORY'
  | 'SANDBOX_ERROR'
  | 'CONFIG_ERROR'
  | 'PROVIDER_ERROR';

export class RCError extends Error {
  readonly code: RCErrorCode;

  constructor(code: RCErrorCode, message: string) {
    super(message);
    this.name = 'RCError';
    this.code = code;
  }
}

export class StorageError extends RCError {
  constructor(message: string) {
    super('STORAGE_ERROR', message);
    this.name = 'StorageError';
  }
}

export class BudgetExceededError extends RCError {
  readonly spent: number;
  readonly limit: number;

  constructor(spent: number, limit: number, scope: 'query' | 'turn') {
    super('BUDGET_EXCEEDED', `Budget limit reached: $${spent.toFixed(4)} spent of $${limit.toFixed(4)} ${scope} cap`);
    this.name = 'BudgetExceededError';
    this.spent = spent;
    this.limit = limit;
  }
}

export class SubQueryError extends RCError {
  readonly provider: string;
  readonly statusCode?: number;

  constructor(provider: string, message: string, statusCode?: number) {
    super('SUBQUERY_ERROR', `Sub-query failed: ${provider} — ${message}`);
    this.name = 'SubQueryError';
    this.provider = provider;
    this.statusCode = statusCode;
  }
}

export class SandboxTimeoutError extends RCError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super('SANDBOX_TIMEOUT', `Code timed out after ${timeoutMs / 1000} seconds. Simplify your query or use smaller slices.`);
    this.name = 'SandboxTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class SandboxMemoryError extends RCError {
  readonly limitMb: number;

  constructor(limitMb: number) {
    super('SANDBOX_MEMORY', `Memory limit exceeded (${limitMb}MB). Process data in smaller chunks.`);
    this.name = 'SandboxMemoryError';
    this.limitMb = limitMb;
  }
}

export class ConfigError extends RCError {
  constructor(message: string) {
    super('CONFIG_ERROR', message);
    this.name = 'ConfigError';
  }
}

export class ProviderError extends RCError {
  readonly provider: string;

  constructor(provider: string, message: string) {
    super('PROVIDER_ERROR', `Provider ${provider}: ${message}`);
    this.name = 'ProviderError';
    this.provider = provider;
  }
}
