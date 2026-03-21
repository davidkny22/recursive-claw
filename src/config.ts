import type { RecursiveClawConfig, ProviderName, EngineMode } from './types.js';

const DEFAULTS: RecursiveClawConfig = {
  mode: 'tools',
  freshTailCount: 20,
  databasePath: '',
  subQuery: {
    defaultProvider: 'anthropic',
    defaultModel: 'claude-haiku-4-5',
    providers: {},
    maxBudgetPerQuery: 0.05,
    maxBudgetPerTurn: 0.10,
    maxConcurrent: 4,
    maxDepth: 1,
    timeout: 30_000,
  },
};

function envString(key: string): string | undefined {
  return process.env[key] || undefined;
}

function envNumber(key: string): number | undefined {
  const val = process.env[key];
  if (val === undefined) return undefined;
  const num = Number(val);
  return Number.isFinite(num) ? num : undefined;
}

/**
 * Resolve config by merging: defaults < plugin JSON config < environment variables.
 * Environment variables take highest precedence for quick overrides.
 */
export function resolveConfig(pluginConfig?: Record<string, unknown>): RecursiveClawConfig {
  const subQueryJson = (pluginConfig?.subQuery ?? {}) as Record<string, unknown>;

  const config: RecursiveClawConfig = {
    mode: (envString('RC_MODE') as EngineMode) ?? (pluginConfig?.mode as EngineMode) ?? DEFAULTS.mode,
    freshTailCount: envNumber('RC_FRESH_TAIL') ?? (pluginConfig?.freshTailCount as number) ?? DEFAULTS.freshTailCount,
    databasePath: envString('RC_DATABASE_PATH') ?? (pluginConfig?.databasePath as string) ?? DEFAULTS.databasePath,
    subQuery: {
      defaultProvider:
        (envString('RC_PROVIDER') as ProviderName) ??
        (subQueryJson.defaultProvider as ProviderName) ??
        DEFAULTS.subQuery.defaultProvider,
      defaultModel:
        envString('RC_MODEL') ??
        (subQueryJson.defaultModel as string) ??
        DEFAULTS.subQuery.defaultModel,
      providers: (subQueryJson.providers as RecursiveClawConfig['subQuery']['providers']) ?? DEFAULTS.subQuery.providers,
      maxBudgetPerQuery:
        envNumber('RC_BUDGET_PER_QUERY') ??
        (subQueryJson.maxBudgetPerQuery as number) ??
        DEFAULTS.subQuery.maxBudgetPerQuery,
      maxBudgetPerTurn:
        envNumber('RC_BUDGET_PER_TURN') ??
        (subQueryJson.maxBudgetPerTurn as number) ??
        DEFAULTS.subQuery.maxBudgetPerTurn,
      maxConcurrent: (subQueryJson.maxConcurrent as number) ?? DEFAULTS.subQuery.maxConcurrent,
      maxDepth: (subQueryJson.maxDepth as number) ?? DEFAULTS.subQuery.maxDepth,
      timeout: (subQueryJson.timeout as number) ?? DEFAULTS.subQuery.timeout,
    },
  };

  // REPL mode overrides maxDepth to 2 if not explicitly set
  if (config.mode === 'repl' && subQueryJson.maxDepth === undefined && !envString('RC_MAX_DEPTH')) {
    config.subQuery.maxDepth = 2;
  }

  return config;
}

export { DEFAULTS as CONFIG_DEFAULTS };
