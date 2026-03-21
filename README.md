# recursive-claw

RLM-native ContextEngine plugin for OpenClaw. Zero information loss. Massive cost reduction.

## What it does

Instead of stuffing conversation history into the context window and summarizing it away, recursive-claw keeps history external in a SQLite database. The model queries it on demand — only pulling in exactly what it needs.

- **80-95% fewer tokens** per turn on the main model
- **Zero information loss** — no compaction, no summarization, ever
- **Cross-session persistence** — full history survives across sessions, queryable forever
- **Multi-provider sub-queries** — cheap model (Haiku default) handles retrieval, expensive model reasons

## Install

```bash
openclaw plugins install recursive-claw
```

## Configure

Add to your `openclaw.json`:

```json
{
  "plugins": {
    "slots": { "contextEngine": "recursive-claw" },
    "entries": {
      "recursive-claw": { "enabled": true }
    }
  }
}
```

That's it. Zero-config defaults: tools mode, SQLite auto-created, 20-message fresh tail, Haiku sub-queries, $0.10/turn budget cap.

## How it works

Every message is stored in SQLite with full-text search (FTS5). When the model needs context, `assemble()` returns only:

1. **System prompt** (original)
2. **Fresh tail** (last 20 messages)
3. **Context manifest** ("You have 847 messages of history. Use these tools to access what you need.")

The model uses five retrieval tools to query history on demand:

| Tool | Purpose |
|------|---------|
| `rc_peek` | View messages at a position in history |
| `rc_grep` | Full-text search or regex across all messages |
| `rc_slice` | Extract a contiguous range by message index |
| `rc_query` | Ask a question — dispatches to cheap sub-agent |
| `rc_timeline` | Structural overview of stored history |

`rc_query` is where the cost savings live: it greps for relevant messages, feeds them to a cheap model (Haiku at $1/$5 per 1M tokens), and returns a focused answer. The expensive model never sees the raw history.

## Modes

### Tools Mode (default)

The model calls registered OpenClaw tools. Simple, debuggable, zero code execution.

### REPL Mode (opt-in)

```json
{ "config": { "mode": "repl" } }
```

The model writes JavaScript in ` ```repl``` ` code blocks. Runs in a sandboxed VM with retrieval functions, `llm_query()`, `store()`/`get()`, and `FINAL()`/`FINAL_VAR()` signals. Power-user feature for complex retrieval patterns.

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `mode` | `"tools"` | `"tools"` or `"repl"` |
| `freshTailCount` | `20` | Messages in the fresh tail |
| `databasePath` | auto | Path to SQLite database |
| `subQuery.defaultProvider` | `"anthropic"` | `anthropic`, `openai`, `google`, `openrouter` |
| `subQuery.defaultModel` | `"claude-haiku-4-5"` | Model for sub-queries |
| `subQuery.maxBudgetPerQuery` | `0.05` | USD cap per sub-query |
| `subQuery.maxBudgetPerTurn` | `0.10` | USD cap per turn |

### Environment variables

```
RC_MODE=tools|repl
RC_FRESH_TAIL=20
RC_DATABASE_PATH=./recursive-claw.db
RC_PROVIDER=anthropic
RC_MODEL=claude-haiku-4-5
RC_BUDGET_PER_QUERY=0.05
RC_BUDGET_PER_TURN=0.10
```

## The paradigm shift

Every other context engine answers "how do we fit more into the window?"

recursive-claw answers "why are we putting it in the window at all?"

## License

MIT

## Author

David Kogan
