import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveConfig, CONFIG_DEFAULTS } from '../../src/config.js';

describe('resolveConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clean RC_ env vars
    Object.keys(process.env).forEach(key => {
      if (key.startsWith('RC_')) delete process.env[key];
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns defaults when no config or env provided', () => {
    const config = resolveConfig();
    expect(config.mode).toBe('tools');
    expect(config.freshTailCount).toBe(20);
    expect(config.subQuery.defaultProvider).toBe('anthropic');
    expect(config.subQuery.defaultModel).toBe('claude-haiku-4-5');
    expect(config.subQuery.maxBudgetPerQuery).toBe(0.05);
    expect(config.subQuery.maxBudgetPerTurn).toBe(0.10);
    expect(config.subQuery.maxConcurrent).toBe(4);
    expect(config.subQuery.maxDepth).toBe(1);
    expect(config.subQuery.timeout).toBe(30_000);
  });

  it('merges plugin JSON config over defaults', () => {
    const config = resolveConfig({
      mode: 'repl',
      freshTailCount: 30,
      subQuery: {
        defaultProvider: 'openai',
        defaultModel: 'gpt-5-nano',
        maxBudgetPerTurn: 0.50,
      },
    });
    expect(config.mode).toBe('repl');
    expect(config.freshTailCount).toBe(30);
    expect(config.subQuery.defaultProvider).toBe('openai');
    expect(config.subQuery.defaultModel).toBe('gpt-5-nano');
    expect(config.subQuery.maxBudgetPerTurn).toBe(0.50);
    // Unset values stay at defaults
    expect(config.subQuery.maxConcurrent).toBe(4);
  });

  it('env vars take precedence over JSON config', () => {
    process.env.RC_MODE = 'tools';
    process.env.RC_FRESH_TAIL = '50';
    process.env.RC_PROVIDER = 'google';
    process.env.RC_MODEL = 'gemini-2.5-flash';
    process.env.RC_BUDGET_PER_TURN = '1.00';
    process.env.RC_BUDGET_PER_QUERY = '0.25';

    const config = resolveConfig({
      mode: 'repl',
      freshTailCount: 30,
      subQuery: { defaultProvider: 'openai' },
    });

    expect(config.mode).toBe('tools');
    expect(config.freshTailCount).toBe(50);
    expect(config.subQuery.defaultProvider).toBe('google');
    expect(config.subQuery.defaultModel).toBe('gemini-2.5-flash');
    expect(config.subQuery.maxBudgetPerTurn).toBe(1.00);
    expect(config.subQuery.maxBudgetPerQuery).toBe(0.25);
  });

  it('REPL mode auto-overrides maxDepth to 2 when not explicitly set', () => {
    const config = resolveConfig({ mode: 'repl' });
    expect(config.mode).toBe('repl');
    expect(config.subQuery.maxDepth).toBe(2);
  });

  it('REPL mode does NOT override maxDepth when explicitly set in config', () => {
    const config = resolveConfig({
      mode: 'repl',
      subQuery: { maxDepth: 1 },
    });
    expect(config.subQuery.maxDepth).toBe(1);
  });

  it('handles invalid env var numbers gracefully', () => {
    process.env.RC_FRESH_TAIL = 'not-a-number';
    const config = resolveConfig();
    expect(config.freshTailCount).toBe(20); // falls back to default
  });

  it('handles empty database path with default', () => {
    const config = resolveConfig();
    expect(config.databasePath).toBe('');
  });

  it('accepts database path from env', () => {
    process.env.RC_DATABASE_PATH = '/tmp/test.db';
    const config = resolveConfig();
    expect(config.databasePath).toBe('/tmp/test.db');
  });
});
