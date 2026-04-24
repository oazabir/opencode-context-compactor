const DEFAULT_OPTIONS = {
    keep_messages: 10,
    mode: "hybrid",
    token_threshold: 2000,
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
function filterTextParts(parts) {
    return parts.filter((part) => {
        if (part.type !== "text")
            return false;
        // Keep text parts, but we could add filtering here if needed
        return true;
    });
}
/**
 * Rough token estimation (4 chars ≈ 1 token for English text)
 */
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
/**
 * Extract readable text from a message, stripping all tool results and metadata
 */
function extractMessageText(msg) {
    const textParts = filterTextParts(msg.parts);
    return textParts.map((p) => p.text).join("\n");
}
/**
 * Build a summary from collected text based on the configured mode
 */
function buildSummary(texts, mode, threshold) {
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
function createSummaryMessage(summaryText, sessionID, agent, model) {
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
const ContextCompactorPlugin = async (input, options = {}) => {
    const config = {
        keep_messages: typeof options.keep_messages === "number"
            ? options.keep_messages
            : DEFAULT_OPTIONS.keep_messages,
        mode: options.mode === "concatenate" || options.mode === "summarize"
            ? options.mode
            : DEFAULT_OPTIONS.mode,
        token_threshold: typeof options.token_threshold === "number"
            ? options.token_threshold
            : DEFAULT_OPTIONS.token_threshold,
    };
    const client = input.client;
    const directory = input.directory;
    /**
     * Fire a toast notification in the OpenCode TUI.
     * Errors are swallowed so a failed toast never breaks compaction.
     */
    const showToast = (title, message, variant = "info") => {
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
            // Nothing to compact if too few messages
            // +2 because we keep first message + last N, so need at least N+2 to have anything in middle
            if (messages.length <= config.keep_messages + 2) {
                return;
            }
            // Split messages into regions
            const firstMessage = messages[0];
            const lastMessages = messages.slice(-config.keep_messages);
            const middleMessages = messages.slice(1, -config.keep_messages);
            // Stats before compaction
            const originalMessageCount = middleMessages.length;
            const originalPartCount = middleMessages.reduce((sum, m) => sum + m.parts.length, 0);
            const originalTokenCount = middleMessages.reduce((sum, m) => sum + estimateTokens(JSON.stringify(m.parts)), 0);
            showToast("Compacting context", `Summarizing ${originalMessageCount} older messages (${originalPartCount} parts)...`, "info");
            // Extract text from middle messages, stripping all tool results
            const middleTexts = [];
            for (const msg of middleMessages) {
                const text = extractMessageText(msg);
                if (text.trim()) {
                    middleTexts.push(text);
                }
            }
            if (middleTexts.length === 0) {
                // Nothing to summarize, just restructure to remove tool results from middle
                output.messages = [firstMessage, ...lastMessages];
                showToast("Context compacted", `${originalMessageCount} messages cleaned (no text to summarize)`, "success");
                return;
            }
            const summary = buildSummary(middleTexts, config.mode, config.token_threshold);
            const firstMessageInfo = firstMessage.info;
            const summaryMessage = createSummaryMessage(summary, firstMessageInfo.sessionID, firstMessageInfo.agent, firstMessageInfo.model);
            const summaryTokens = estimateTokens(summary);
            const savedTokens = Math.max(0, originalTokenCount - summaryTokens);
            showToast("Context compacted", `${originalMessageCount} messages → 1 summary (~${savedTokens.toLocaleString()} tokens saved)`, "success");
            // Reconstruct message array: [first, summary, ...last N]
            output.messages = [firstMessage, summaryMessage, ...lastMessages];
        },
    };
};
export default ContextCompactorPlugin;
