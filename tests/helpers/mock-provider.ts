import type { SubQueryProvider } from '../../src/subquery/provider-interface.js';
import type { SubQueryCompletion } from '../../src/types.js';

export class MockProvider implements SubQueryProvider {
  readonly name = 'mock';
  readonly model = 'mock-model';
  callCount = 0;
  lastMessages: Array<{ role: string; content: string }> = [];
  responseContent = 'Mock answer';
  shouldFail = false;

  async complete(
    messages: Array<{ role: string; content: string }>
  ): Promise<SubQueryCompletion> {
    this.callCount++;
    this.lastMessages = messages;

    if (this.shouldFail) {
      throw new Error('Mock provider failure');
    }

    return {
      content: this.responseContent,
      usage: { inputTokens: 100, outputTokens: 50 },
      cost: 0.001,
    };
  }

  reset(): void {
    this.callCount = 0;
    this.lastMessages = [];
    this.responseContent = 'Mock answer';
    this.shouldFail = false;
  }
}
