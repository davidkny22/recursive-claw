import OpenAI from 'openai';
import type { SubQueryProvider } from '../provider-interface.js';
import type { SubQueryCompletion } from '../../types.js';
import { ProviderError } from '../../errors.js';

// GPT-4o-mini pricing per 1M tokens
const DEFAULT_INPUT_COST = 0.15;
const DEFAULT_OUTPUT_COST = 0.6;

export class OpenAIProvider implements SubQueryProvider {
  readonly name = 'openai';
  readonly model: string;
  private client: OpenAI;

  constructor(apiKey?: string, model?: string) {
    this.model = model ?? 'gpt-4o-mini';
    this.client = new OpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY });
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
      const cost = (inputTokens * DEFAULT_INPUT_COST + outputTokens * DEFAULT_OUTPUT_COST) / 1_000_000;

      return { content, usage: { inputTokens, outputTokens }, cost };
    } catch (err) {
      throw new ProviderError('openai', `${err}`);
    }
  }
}
