# Context Compactor Plugin - Agent Guide

## Overview

OpenCode plugin that auto-compacts conversation context. Strips tool results and summarizes old messages while preserving the first message and last 10 messages with all tool calls intact.

**Hook:** `experimental.chat.messages.transform`

## Algorithm

```
IF total_messages <= keep_messages + 2:
    RETURN messages unchanged

IF total_messages < compact_after_messages:
    RETURN messages unchanged

total_tokens = estimate_tokens(all_messages)
IF context_threshold > 0 AND total_tokens < context_threshold:
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
  cli.ts      — npx installer script
 dist/
  index.js    — Compiled output (run `npm run build`)
  cli.js      — Compiled CLI installer
  index.d.ts  — Type definitions
```

## Dev Commands

```bash
npm run build      # Compile TypeScript
npm run typecheck  # Type check without emit
```

## npx Installer

The package includes a CLI installer at `dist/cli.js` that is registered as a `bin` entry:

```json
{
  "bin": {
    "opencode-context-compactor": "dist/cli.js"
  }
}
```

Running `npx opencode-context-compactor` will:
1. Detect `~/.config/opencode/config.json` (or `~/.opencode/config.json`)
2. Create the config file if missing
3. Add the plugin entry if not already present
4. Optionally prompt for custom settings (use `--yes` to skip)

## Toast Notifications

The plugin shows TUI toast notifications on compaction:
- **"Compacting context"** (info) — shown when compaction starts, with message/part counts and total token estimate
- **"Context compacted"** (success) — shown when done, with how many messages were collapsed and estimated token savings

## Configuration

Passed via plugin options in `config.json`:

| Option | Default | Description |
|--------|---------|-------------|
| `keep_messages` | 10 | Messages to preserve at end |
| `mode` | "hybrid" | "concatenate" / "summarize" / "hybrid" |
| `token_threshold` | 2000 | Switch to truncate in hybrid mode |
| `context_threshold` | 0 | Min total tokens to trigger compaction (0 = message-count only) |
| `compact_after_messages` | 100 | Min total messages before compaction triggers |

## Coding Rules

- Import types from `@opencode-ai/sdk` (not `/v2`) to match plugin SDK version
- Use `satisfies` or explicit casts for message role types
- Synthetic summary messages use `"user"` role with `synthetic: true` flag
- Message IDs prefixed with `compactor-{timestamp}-{random}`
- No external API calls — summarization is local truncation only (LLM summary is future work)
- When architecture change, API changes done, update this file AGENTS.md

## Testing

Manual test: add plugin to OpenCode config, start a long conversation (>12 messages), verify middle messages are compacted into a single summary message.

## CI/CD

GitHub Actions workflows:
- `.github/workflows/ci.yml` — runs `npm run typecheck` and `npm run build` on push/PR
- `.github/workflows/publish.yml` — publishes to npm on release (requires `NPM_TOKEN` secret)

## Mistakes

- Avoid mistakes in MISTAKES.md
- Append mistakes to MISTAKES.md
