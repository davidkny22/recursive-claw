import { GoogleGenAI } from '@google/genai';
import type { SubQueryProvider } from '../provider-interface.js';
import type { SubQueryCompletion } from '../../types.js';
import { ProviderError } from '../../errors.js';

// Gemini 2.5 Flash pricing per 1M tokens
const DEFAULT_INPUT_COST = 0.15;
const DEFAULT_OUTPUT_COST = 0.6;

export class GoogleProvider implements SubQueryProvider {
  readonly name = 'google';
  readonly model: string;
  private client: GoogleGenAI;

  constructor(apiKey?: string, model?: string) {
    this.model = model ?? 'gemini-2.5-flash';
    this.client = new GoogleGenAI({ apiKey: apiKey ?? process.env.GOOGLE_API_KEY ?? '' });
  }

  async complete(
    messages: Array<{ role: string; content: string }>,
    opts?: { maxTokens?: number; temperature?: number }
  ): Promise<SubQueryCompletion> {
    try {
      const systemMsg = messages.find(m => m.role === 'system');
      const chatMessages = messages
        .filter(m => m.role !== 'system')
        .map(m => ({
          role: m.role === 'assistant' ? 'model' as const : 'user' as const,
          parts: [{ text: m.content }],
        }));

      const response = await this.client.models.generateContent({
        model: this.model,
        config: {
          maxOutputTokens: opts?.maxTokens ?? 1024,
          temperature: opts?.temperature ?? 0,
          systemInstruction: systemMsg?.content,
        },
        contents: chatMessages,
      });

      const content = response.text ?? '';
      const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
      const cost = (inputTokens * DEFAULT_INPUT_COST + outputTokens * DEFAULT_OUTPUT_COST) / 1_000_000;

      return { content, usage: { inputTokens, outputTokens }, cost };
    } catch (err) {
      throw new ProviderError('google', `${err}`);
    }
  }
}
