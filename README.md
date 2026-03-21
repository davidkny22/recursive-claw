<p align="center">
  <h1 align="center">recursive-claw</h1>
  <p align="center">RLM-native ContextEngine plugin for OpenClaw</p>
  <p align="center"><i>Stop compacting. Start querying.</i></p>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/recursive-claw"><img src="https://img.shields.io/npm/v/recursive-claw?color=coral" alt="npm version"></a>
  <a href="https://github.com/davidkny22/recursive-claw"><img src="https://img.shields.io/badge/OpenClaw-2026.3.7%2B-blue" alt="OpenClaw compatibility"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License"></a>
</p>

---

Conversation history doesn't belong in the context window. recursive-claw keeps it external in SQLite and gives the model tools to query what it needs, when it needs it. No compaction. No summarization. Nothing is ever lost.

Based on MIT's [Recursive Language Models](https://arxiv.org/abs/2512.24601) paradigm.

## Why

| | Legacy / lossless-claw | recursive-claw |
|---|---|---|
| **History in context** | Summaries + tail (grows with conversation) | Tail only (constant) |
| **Information loss** | Compaction discards detail at every depth | Zero. Ever. |
| **Token cost per turn** | Scales with history length | Flat (~2K tokens) |
| **50K-token history** | ~50K tokens per turn | ~2K + sub-query on demand |
| **Cross-session** | Lost or degraded | Fully queryable |

## Install

```bash
openclaw plugins install recursive-claw
```

That's it. Zero config needed. SQLite auto-created, Haiku sub-queries, $0.10/turn budget cap.

## How it works

Every message is stored in SQLite with FTS5 full-text search. `assemble()` returns only the system prompt, a fresh tail (last 20 messages), and a context manifest. The model queries history on demand.

```
┌──────────────────────────────────────┐
│         OpenClaw Agent Turn          │
│                                      │
│   System prompt                      │
│   + Fresh tail (last 20 messages)    │
│   + Manifest: "847 messages stored"  │
│   + 6 retrieval tools                │
│                                      │
│   History stays in SQLite ──────────►│──── rc_grep("auth decision")
│   Model queries on demand            │◄─── "JWT with RS256, 15-min access tokens"
└──────────────────────────────────────┘
```

## Tools

| Tool | What it does |
|------|-------------|
| `rc_peek` | View messages at a position in history |
| `rc_grep` | Full-text search or regex across all stored messages |
| `rc_slice` | Extract a contiguous range by message index |
| `rc_query` | Ask a question — dispatches to cheap sub-agent for focused answer |
| `rc_timeline` | Structural overview: time periods, message counts, index ranges |
| `rc_repl` | Run JavaScript in a sandboxed REPL with all retrieval functions |

`rc_query` is where the cost savings live. It greps for relevant messages, feeds them to a cheap model (Haiku at $1/$5 per 1M tokens), and returns a focused answer. The main model never sees the raw history.

## Configuration

Works with zero config. Customize when you need to:

| Option | Default | Description |
|--------|---------|-------------|
| `mode` | `"tools"` | `"tools"` or `"repl"` |
| `freshTailCount` | `20` | Messages kept in context window |
| `databasePath` | auto | SQLite database path |
| `subQuery.defaultProvider` | `"anthropic"` | `anthropic`, `openai`, `google`, `openrouter` |
| `subQuery.defaultModel` | `"claude-haiku-4-5"` | Model for retrieval sub-queries |
| `subQuery.maxBudgetPerQuery` | `0.05` | USD cap per sub-query |
| `subQuery.maxBudgetPerTurn` | `0.10` | USD cap per turn |

Environment variables (`RC_MODE`, `RC_PROVIDER`, `RC_MODEL`, `RC_BUDGET_PER_TURN`, etc.) override config for quick testing.

## Benchmarks

Formal benchmarks comparing recursive-claw against legacy compaction and lossless-claw are in progress. Measuring: token usage per turn, cost per session, retrieval accuracy (planted-fact recall), and latency. Results and a research paper to follow.

## Based on

recursive-claw implements the paradigm from [Recursive Language Models](https://arxiv.org/abs/2512.24601) (Zhang, Kraska, Khattab — MIT CSAIL, 2025). Context stays external. The model programs its way to what it needs.

## License

[MIT](LICENSE)

---

<p align="center">
  Built by <a href="https://github.com/davidkny22">David Kogan</a>
</p>
