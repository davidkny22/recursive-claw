import type { SubQueryProvider } from './provider-interface.js';
import type { SubQueryConfig, ProviderName, SubQueryCompletion } from '../types.js';
import { AnthropicProvider } from './providers/anthropic-provider.js';
import { OpenAIProvider } from './providers/openai-provider.js';
import { GoogleProvider } from './providers/google-provider.js';
import { OpenRouterProvider } from './providers/openrouter-provider.js';
import { SubQueryError } from '../errors.js';

export class ProviderRouter {
  private providers = new Map<string, SubQueryProvider>();
  private config: SubQueryConfig;

  constructor(config: SubQueryConfig) {
    this.config = config;
  }

  async complete(
    messages: Array<{ role: string; content: string }>,
    opts?: { model?: string; provider?: ProviderName }
  ): Promise<SubQueryCompletion> {
    const providerName = opts?.provider ?? this.config.defaultProvider;
    const provider = this.getOrCreateProvider(providerName, opts?.model);

    // Try with one retry on failure
    try {
      return await provider.complete(messages);
    } catch (firstErr) {
      // Wait 1s then retry once
      await new Promise(resolve => setTimeout(resolve, 1000));
      try {
        return await provider.complete(messages);
      } catch (retryErr) {
        throw new SubQueryError(
          providerName,
          `Failed after retry: ${retryErr}`,
          (retryErr as Record<string, unknown>).status as number | undefined
        );
      }
    }
  }

  private getOrCreateProvider(name: ProviderName, modelOverride?: string): SubQueryProvider {
    const key = `${name}:${modelOverride ?? 'default'}`;
    let provider = this.providers.get(key);

    if (!provider) {
      const providerConfig = this.config.providers[name];
      const apiKey = providerConfig?.apiKey;
      const model = modelOverride ?? providerConfig?.model ?? this.config.defaultModel;

      switch (name) {
        case 'anthropic':
          provider = new AnthropicProvider(apiKey, model);
          break;
        case 'openai':
          provider = new OpenAIProvider(apiKey, model);
          break;
        case 'google':
          provider = new GoogleProvider(apiKey, model);
          break;
        case 'openrouter':
          provider = new OpenRouterProvider(apiKey, model);
          break;
      }

      this.providers.set(key, provider);
    }

    return provider;
  }
}
