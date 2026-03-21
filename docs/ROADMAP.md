# recursive-claw Roadmap

## Pre-Release (must do before v0.1.0 npm publish)

- [ ] **Live REPL mode test** — We tested tools mode E2E against OpenClaw but haven't tested REPL mode live. Need to configure `mode: "repl"` in the test profile, send code blocks, verify FINAL() works.
- [ ] **Multi-provider live test** — Verify real API calls work through Anthropic, OpenAI, Google, OpenRouter. Need API keys for each. Currently only tested with mocks.
- [ ] **Remove debug console.log statements** — Clean up all `[recursive-claw]` logging for production. Replace with proper structured logging or remove.
- [ ] **Fix first-turn workspace bloat** — The 115+ bootstrap messages from OpenClaw workspace setup get stored on first turn. These are workspace setup, not conversation history. Need to detect and skip bootstrap messages.
- [ ] **npm publish prep** — Verify package builds clean, `npm pack` produces correct tarball, openclaw.plugin.json included, dist/ correct.

## v0.2.0 — Block Storage + Workspace Externalization

### Block-level storage
- [ ] **Block definition**: A block is either:
  - A user message → agent response + tool calls → next user message (interactive block)
  - Up to 5 consecutive non-user messages (autonomous block) — parallel tool calls (assistant tool_use + tool results in sequence) always stay together as one unit
- [ ] **Detect parallel tool calls**: assistant message with tool_use content blocks followed immediately by tool_result messages = one atomic unit, never split
- [ ] **`message_blocks` table**: block_id, session_id, block_index, combined_content (FTS), message_start/end indices, block_type (interactive/autonomous), timestamp range
- [ ] **`message_blocks_fts`**: FTS5 index on combined block content — search returns full conversational context, not isolated messages
- [ ] **rc_grep returns blocks**: search hits return the full block, so a tool result hit includes the user question that triggered it
- [ ] **rc_slice still works at message level**: for precision access when blocks are too coarse

### Workspace context externalization
- [ ] **Selective stripping (approach B)**: Keep identity-critical files in system prompt (SOUL.md, IDENTITY.md, USER.md — ~2.7K total). Externalize large operational files (AGENTS.md, BOOTSTRAP.md — ~9K).
- [ ] **Always keep tool definitions in prompt**: Tools are part of the REPL/tools paradigm, they need to be visible. Don't externalize tool docs.
- [ ] **`workspace_files` table**: Store extracted workspace content with filename, content, last_modified, token_estimate
- [ ] **`rc_workspace(filename?)`**: List available files or return one file's content
- [ ] **`rc_workspace_grep(pattern)`**: FTS search across all workspace files
- [ ] **Detect workspace file boundaries**: Parse system prompt for injected file markers (headers, separators) to extract content
- [ ] **Tiered on subsequent turns**: First turn includes more context, later turns rely more on workspace tools

## v0.3.0 — Performance + Research

### Benchmarking suite
- [ ] **Token usage comparison**: recursive-claw vs legacy vs lossless-claw at 1K/10K/50K/100K message histories
- [ ] **Cost comparison**: Total USD across identical workloads
- [ ] **Retrieval accuracy**: Planted-fact recall rate at various history depths
- [ ] **Latency**: assemble() time with/without sub-queries
- [ ] **Publish results in README** with hard numbers

### Research paper
- [ ] Formal comparison against legacy compaction and DAG-based summarization
- [ ] Cost/quality tradeoff curves across sub-query model tiers
- [ ] Scaling behavior analysis (10K → 1M+ messages)
- [ ] Real-world case studies from Clawnitor operator agents

### Performance optimizations
- [ ] **Token-budget-based tail**: Express freshTailCount as token budget instead of message count, so tail adapts to message density
- [ ] **Background re-indexing**: Move FTS5 maintenance to afterTurn() instead of blocking on ingest
- [ ] **Connection pooling**: Reuse SQLite connections across turns instead of open/close per bootstrap

## v0.4.0 — Commercial Layer

### Cloud sync (paid feature)
- [ ] Implement cloud-backed StorageInterface
- [ ] Cross-machine persistence
- [ ] Team shared context pools
- [ ] Auth + access control
- [ ] Sync conflict resolution

### Dashboard
- [ ] Context usage visualization
- [ ] Cost tracking dashboard
- [ ] Query pattern analytics
- [ ] Per-agent retrieval stats

## Ongoing

- [ ] **isolated-vm investigation**: Revisit for proper V8 isolate sandbox when Apple Silicon support improves. Current vm module + code validator is defense-in-depth but not a true sandbox.
- [ ] **OpenClaw plugin config passthrough**: File issue / investigate why `plugins.entries.recursive-claw.config` isn't passed to the ContextEngine factory. Currently using env vars as workaround.
- [ ] **Deeper REPL mode**: Map-reduce patterns, parallel sub-queries from REPL, llm_query_parallel support
- [ ] **FTS5 alternatives**: Consider tantivy or other full-text engines if FTS5 becomes a bottleneck at scale
