# OpenCode Context Compactor Plugin

Automatically compacts conversation context by deleting old tool results and summarizing old messages, while preserving the first message and last 10 messages with all their tool calls intact.

## Quick Install

The fastest way to install:

```bash
npx opencode-context-compactor
```

Or with default settings (no prompts):

```bash
npx opencode-context-compactor --yes
```

This will automatically detect your OpenCode config and add the plugin.

## Manual Installation

### Option 1: Local Install (Recommended for Development)

```bash
cd opencode-context-compactor
npm link
```

Then add to your OpenCode config (`~/.config/opencode/config.json`):

```json
{
  "plugin": [
    ["opencode-context-compactor", {
      "keep_messages": 10,
      "mode": "hybrid",
      "token_threshold": 2000
    }]
  ]
}
```

### Option 2: Direct Path

```json
{
  "plugin": [
    ["/path/to/opencode-context-compactor", {
      "keep_messages": 10
    }]
  ]
}
```

Then add to your OpenCode config (`~/.config/opencode/config.json`):

```json
{
  "plugin": [
    ["opencode-context-compactor", {
      "keep_messages": 10,
      "mode": "hybrid",
      "token_threshold": 2000
    }]
  ]
}
```

### Option 2: Direct Path

```json
{
  "plugin": [
    ["/path/to/opencode-context-compactor", {
      "keep_messages": 10
    }]
  ]
}
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `keep_messages` | number | 10 | Number of recent messages to preserve with all tool calls |
| `mode` | string | "hybrid" | Summarization mode: "concatenate", "summarize", or "hybrid" |
| `token_threshold` | number | 2000 | In hybrid mode, switch to summarize when old text exceeds this token count |

## Modes Explained

- **concatenate**: Always join old message text with separators. Fast, no API calls.
- **summarize**: Always truncate/compact old text. More aggressive compression.
- **hybrid** (recommended): Use concatenation for short histories, summarize for long ones.

## How It Works

```
Original: [Msg0, Msg1, Msg2, Msg3, Msg4, Msg5, Msg6, Msg7, Msg8, Msg9, Msg10, Msg11, Msg12, Msg13, Msg14]
                              ↑ middle messages (strip tools, keep text) ↑
                                    ↓
Compacted: [Msg0, Summary, Msg5, Msg6, Msg7, Msg8, Msg9, Msg10, Msg11, Msg12, Msg13, Msg14]
                 ↑ synthesized from Msg1-4 text
```

## Requirements

- OpenCode CLI with plugin support
- Node.js 18+

## License

MIT
