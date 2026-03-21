export const RC_PEEK_DEFINITION = {
  name: 'rc_peek',
  description: 'View raw messages at a position in history',
  parameters: {
    type: 'object' as const,
    properties: {
      offset: { type: 'number', description: 'Message offset from end (0 = most recent)' },
      length: { type: 'number', description: 'Number of messages to return (default: 10)' },
      sessionId: { type: 'string', description: 'Session to peek into (default: current)' },
    },
    required: ['offset'],
  },
};

export const RC_GREP_DEFINITION = {
  name: 'rc_grep',
  description: 'Search across all stored messages by text or regex',
  parameters: {
    type: 'object' as const,
    properties: {
      pattern: { type: 'string', description: 'Search query or regex pattern' },
      mode: { type: 'string', enum: ['fts', 'regex'], description: 'Search mode (default: fts)' },
      scope: { type: 'string', enum: ['current', 'all'], description: 'Current session or all sessions (default: current)' },
      since: { type: 'string', description: 'ISO timestamp lower bound' },
      before: { type: 'string', description: 'ISO timestamp upper bound' },
      limit: { type: 'number', description: 'Max results (default: 20)' },
    },
    required: ['pattern'],
  },
};

export const RC_SLICE_DEFINITION = {
  name: 'rc_slice',
  description: 'Extract a contiguous range of messages by message index',
  parameters: {
    type: 'object' as const,
    properties: {
      start: { type: 'number', description: 'Start message index (inclusive)' },
      end: { type: 'number', description: 'End message index (exclusive)' },
      sessionId: { type: 'string', description: 'Session to slice from (default: current)' },
    },
    required: ['start', 'end'],
  },
};

export const RC_QUERY_DEFINITION = {
  name: 'rc_query',
  description: 'Ask a question about history — dispatches to cheap sub-agent that reads relevant messages and returns a focused answer',
  parameters: {
    type: 'object' as const,
    properties: {
      question: { type: 'string', description: 'Question to answer from history' },
      scope: { type: 'string', enum: ['current', 'all'], description: 'Current session or all sessions (default: current)' },
      model: { type: 'string', description: 'Override sub-query model' },
      budget: { type: 'number', description: 'USD cap for this query' },
    },
    required: ['question'],
  },
};

export const RC_TIMELINE_DEFINITION = {
  name: 'rc_timeline',
  description: 'Get structural overview of stored history — time periods, message counts, and message index ranges',
  parameters: {
    type: 'object' as const,
    properties: {
      sessionId: { type: 'string', description: 'Session to get timeline for (default: current)' },
    },
  },
};

export const RC_REPL_DEFINITION = {
  name: 'rc_repl',
  description: 'Run JavaScript code in a sandboxed REPL with access to all retrieval functions (peek, grep, slice, query, timeline, llm_query). Use store()/get() for variable persistence across calls. Call FINAL(answer) to return a result.',
  parameters: {
    type: 'object' as const,
    properties: {
      code: { type: 'string', description: 'JavaScript code to run in the REPL sandbox' },
    },
    required: ['code'],
  },
};

export const ALL_TOOL_DEFINITIONS = [
  RC_PEEK_DEFINITION,
  RC_GREP_DEFINITION,
  RC_SLICE_DEFINITION,
  RC_QUERY_DEFINITION,
  RC_TIMELINE_DEFINITION,
];
