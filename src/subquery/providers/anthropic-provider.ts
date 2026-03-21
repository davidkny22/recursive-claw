import Anthropic from '@anthropic-ai/sdk';
import type { SubQueryProvider } from '../provider-interface.js';
import type { SubQueryCompletion } from '../../types.js';
import { ProviderError } from '../../errors.js';

// Haiku pricing per 1M tokens
const HAIKU_INPUT_COST = 1.0;
const HAIKU_OUTPUT_COST = 5.0;

export class AnthropicProvider implements SubQueryProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private client: Anthropic;

  constructor(apiKey?: string, model?: string) {
    this.model = model ?? 'claude-haiku-4-5';
    this.client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY });
  }

  async complete(
    messages: Array<{ role: string; content: string }>,
    opts?: { maxTokens?: number; temperature?: number }
  ): Promise<SubQueryCompletion> {
    try {
      const systemMsg = messages.find(m => m.role === 'system');
      const chatMessages = messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: opts?.maxTokens ?? 1024,
        temperature: opts?.temperature ?? 0,
        system: systemMsg?.content,
        messages: chatMessages,
      });

      const content = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;
      const cost = (inputTokens * HAIKU_INPUT_COST + outputTokens * HAIKU_OUTPUT_COST) / 1_000_000;

      return { content, usage: { inputTokens, outputTokens }, cost };
    } catch (err) {
      throw new ProviderError('anthropic', `${err}`);
    }
  }
}
