import type { Plugin, PluginInput } from "@opencode-ai/plugin";

// Import types from the same path the plugin uses to avoid version mismatches
type Message = import("@opencode-ai/sdk").Message;
type Part = import("@opencode-ai/sdk").Part;
type TextPart = import("@opencode-ai/sdk").TextPart;
type UserMessage = import("@opencode-ai/sdk").UserMessage;

/**
 * Context Compactor Plugin for OpenCode
 *
 * Automatically compacts conversation context by:
 * 1. Preserving the first message (system/user) and last N messages with all their tool calls
 * 2. Stripping tool results, files, snapshots, patches, reasoning from old messages
 * 3. Keeping only text parts from old messages
 * 4. Summarizing old text (concatenate or LLM-based depending on mode)
 */

interface CompactorOptions {
  /** Number of recent messages to preserve (default: 10) */
  keep_messages?: number;
  /** Summarization mode: "concatenate", "summarize", or "hybrid" (default: "hybrid") */
  mode?: "concatenate" | "summarize" | "hybrid";
  /** Token threshold for switching from concatenate to summarize in hybrid mode (default: 2000) */
  token_threshold?: number;
  /**
   * Minimum total context tokens required to trigger auto-compaction.
   * Compaction only runs when estimated tokens across all messages
   * meets or exceeds this value. Set to 0 to disable (compact on message count only).
   */
  context_threshold?: number;
  /** Minimum total message count before compaction triggers (default: 100) */
  compact_after_messages?: number;
}

const DEFAULT_OPTIONS: Required<CompactorOptions> = {
  keep_messages: 10,
  mode: "hybrid",
  token_threshold: 2000,
  context_threshold: 0,
  compact_after_messages: 100,
};

// Types that should be stripped from old messages
const STRIPPED_PART_TYPES = new Set([
  "tool",
  "file",
  "snapshot",
  "patch",
  "reasoning",
  "subtask",
  "retry",
  "compaction",
  "step-start",
  "step-finish",
  "agent",
]);

/**
 * Filter out non-text parts from a message
 */
function filterTextParts(parts: Part[]): TextPart[] {
  return parts.filter((part): part is TextPart => {
    if (part.type !== "text") return false;
    // Keep text parts, but we could add filtering here if needed
    return true;
  });
}

/**
 * Rough token estimation (4 chars ≈ 1 token for English text)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Extract readable text from a message, stripping all tool results and metadata
 */
function extractMessageText(msg: { info: Message; parts: Part[] }): string {
  const textParts = filterTextParts(msg.parts);
  return textParts.map((p) => p.text).join("\n");
}

/**
 * Build a summary from collected text based on the configured mode
 */
function buildSummary(
  texts: string[],
  mode: "concatenate" | "summarize" | "hybrid",
  threshold: number
): string {
  const combined = texts.join("\n\n---\n\n");
  const tokens = estimateTokens(combined);

  if (mode === "concatenate") {
    return `📋 Previous context:\n\n${combined}`;
  }

  if (mode === "hybrid" && tokens <= threshold) {
    return `📋 Previous context:\n\n${combined}`;
  }

  // Summarize mode or hybrid over threshold
  // For now, use truncation with ellipsis as a simple summarization
  // In a future version, this could call an LLM for true summarization
  const maxChars = threshold * 4;
  if (combined.length > maxChars) {
    return `📋 Previous context (summarized):\n\n${combined.substring(0, maxChars)}...\n\n[Older messages truncated - ${texts.length} messages summarized]`;
  }

  return `📋 Previous context:\n\n${combined}`;
}

/**
 * Create a synthetic user message containing the summary
 */
function createSummaryMessage(
  summaryText: string,
  sessionID: string,
  agent: string,
  model: { providerID: string; modelID: string; variant?: string }
): { info: UserMessage; parts: TextPart[] } {
  const messageID = `compactor-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const now = Date.now();

  return {
    info: {
      id: messageID,
      sessionID,
      role: "user",
      time: { created: now },
      agent,
      model,
    },
    parts: [
      {
        id: `${messageID}-text`,
        sessionID,
        messageID,
        type: "text",
        text: summaryText,
        synthetic: true,
      },
    ],
  };
}

const ContextCompactorPlugin: Plugin = async (input: PluginInput, options = {}) => {
  const config: Required<CompactorOptions> = {
    keep_messages:
      typeof options.keep_messages === "number"
        ? options.keep_messages
        : DEFAULT_OPTIONS.keep_messages,
    mode:
      options.mode === "concatenate" || options.mode === "summarize"
        ? options.mode
        : DEFAULT_OPTIONS.mode,
    token_threshold:
      typeof options.token_threshold === "number"
        ? options.token_threshold
        : DEFAULT_OPTIONS.token_threshold,
    context_threshold:
      typeof options.context_threshold === "number"
        ? options.context_threshold
        : DEFAULT_OPTIONS.context_threshold,
    compact_after_messages:
      typeof options.compact_after_messages === "number"
        ? options.compact_after_messages
        : DEFAULT_OPTIONS.compact_after_messages,
  };

  const client = input.client;
  const directory = input.directory;

  /**
   * Fire a toast notification in the OpenCode TUI.
   * Errors are swallowed so a failed toast never breaks compaction.
   */
  const showToast = (
    title: string,
    message: string,
    variant: "info" | "success" | "warning" | "error" = "info"
  ) => {
    client.tui
      .showToast({
        body: { title, message, variant, duration: 4000 },
        query: { directory },
      })
      .catch(() => {
        /* ignore toast errors */
      });
  };

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const messages = output.messages;

      // Nothing to compact if total messages haven't reached the threshold
      if (messages.length < config.compact_after_messages) {
        return;
      }

      const totalTokens = messages.reduce(
        (sum, m) => sum + estimateTokens(JSON.stringify(m.parts)),
        0
      );

      // If context_threshold is set, only compact when total context is large enough
      if (
        config.context_threshold > 0 &&
        totalTokens < config.context_threshold
      ) {
        return;
      }

      // Split messages into regions
      const firstMessage = messages[0];
      const lastMessages = messages.slice(-config.keep_messages);
      const middleMessages = messages.slice(1, -config.keep_messages);

      // Stats before compaction
      const originalMessageCount = middleMessages.length;
      const originalPartCount = middleMessages.reduce(
        (sum, m) => sum + m.parts.length,
        0
      );
      const originalTokenCount = middleMessages.reduce(
        (sum, m) => sum + estimateTokens(JSON.stringify(m.parts)),
        0
      );

      showToast(
        "Compacting context",
        `${originalMessageCount} older messages (${originalPartCount} parts, ~${totalTokens.toLocaleString()} tokens total)...`,
        "info"
      );

      // Extract text from middle messages, stripping all tool results
      const middleTexts: string[] = [];
      for (const msg of middleMessages) {
        const text = extractMessageText(msg);
        if (text.trim()) {
          middleTexts.push(text);
        }
      }

      if (middleTexts.length === 0) {
        // Nothing to summarize, just restructure to remove tool results from middle
        output.messages = [firstMessage, ...lastMessages];
        showToast(
          "Context compacted",
          `${originalMessageCount} messages cleaned (no text to summarize)`,
          "success"
        );
        return;
      }

      const summary = buildSummary(
        middleTexts,
        config.mode,
        config.token_threshold
      );

      const firstMessageInfo = firstMessage.info as UserMessage;

      const summaryMessage = createSummaryMessage(
        summary,
        firstMessageInfo.sessionID,
        firstMessageInfo.agent,
        firstMessageInfo.model
      );

      const summaryTokens = estimateTokens(summary);
      const savedTokens = Math.max(0, originalTokenCount - summaryTokens);

      showToast(
        "Context compacted",
        `${originalMessageCount} messages → 1 summary (~${savedTokens.toLocaleString()} tokens saved)`,
        "success"
      );

      // Reconstruct message array: [first, summary, ...last N]
      output.messages = [firstMessage, summaryMessage, ...lastMessages];
    },
  };
};

export default ContextCompactorPlugin;
