import OpenAI from 'openai';
import type { SubQueryProvider } from '../provider-interface.js';
import type { SubQueryCompletion } from '../../types.js';
import { ProviderError } from '../../errors.js';

export class OpenRouterProvider implements SubQueryProvider {
  readonly name = 'openrouter';
  readonly model: string;
  private client: OpenAI;

  constructor(apiKey?: string, model?: string) {
    this.model = model ?? 'anthropic/claude-haiku-4-5';
    this.client = new OpenAI({
      apiKey: apiKey ?? process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
    });
  }

  async complete(
    messages: Array<{ role: string; content: string }>,
    opts?: { maxTokens?: number; temperature?: number }
  ): Promise<SubQueryCompletion> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: opts?.maxTokens ?? 1024,
        temperature: opts?.temperature ?? 0,
        messages: messages.map(m => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content,
        })),
      });

      const content = response.choices[0]?.message?.content ?? '';
      const inputTokens = response.usage?.prompt_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;

      // OpenRouter returns cost via x-openrouter-cost header or usage extension
      // Estimate from tokens if not available
      const cost = (response as unknown as Record<string, unknown>).cost as number
        ?? (inputTokens * 1.0 + outputTokens * 5.0) / 1_000_000;

      return { content, usage: { inputTokens, outputTokens }, cost };
    } catch (err) {
      throw new ProviderError('openrouter', `${err}`);
    }
  }
}
