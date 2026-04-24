# Context Compactor Plugin - Agent Guide

## Overview

OpenCode plugin that auto-compacts conversation context. Strips tool results and summarizes old messages while preserving the first message and last 10 messages with all tool calls intact.

**Hook:** `experimental.chat.messages.transform`

## Algorithm

```
IF total_messages <= keep_messages + 2:
    RETURN messages unchanged

first = messages[0]
last = messages[-keep_messages:]
middle = messages[1:-keep_messages]

FOR msg IN middle:
    KEEP only text parts
    DISCARD: tool, file, snapshot, patch, reasoning, subtask, retry, compaction, step-start, step-finish, agent

summary = build_summary(extracted_texts, mode, threshold)

RETURN [first, summary_message, ...last]
```

**Summary modes:**
- `concatenate` — always join text with separators
- `hybrid` — concatenate if under threshold tokens, else truncate  
- `summarize` — always truncate

## Tech Stack

- TypeScript 5.8
- `@opencode-ai/plugin` SDK
- ESM modules (`"type": "module"`)

## File Structure

```
src/
  index.ts    — Main plugin entry, all logic here (~200 lines)
dist/
  index.js    — Compiled output (run `npm run build`)
  index.d.ts  — Type definitions
```

## Dev Commands

```bash
npm run build      # Compile TypeScript
npm run typecheck  # Type check without emit
```

## Configuration

Passed via plugin options in `config.json`:

| Option | Default | Description |
|--------|---------|-------------|
| `keep_messages` | 10 | Messages to preserve at end |
| `mode` | "hybrid" | "concatenate" / "summarize" / "hybrid" |
| `token_threshold` | 2000 | Switch to truncate in hybrid mode |

## Coding Rules

- Import types from `@opencode-ai/sdk` (not `/v2`) to match plugin SDK version
- Use `satisfies` or explicit casts for message role types
- Synthetic summary messages use `"user"` role with `synthetic: true` flag
- Message IDs prefixed with `compactor-{timestamp}-{random}`
- No external API calls — summarization is local truncation only (LLM summary is future work)
- When architecture change, API changes done, update this file AGENTS.md

## Testing

Manual test: add plugin to OpenCode config, start a long conversation (>12 messages), verify middle messages are compacted into a single summary message.

## Mistakes

- Avoid mistakes in MISTAKES.md
- Append mistakes to MISTAKES.md
