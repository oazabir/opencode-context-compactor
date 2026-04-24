import { describe, it, expect, vi, beforeEach } from "vitest";
import ContextCompactorPlugin from "./index.js";
import type { PluginInput } from "@opencode-ai/plugin";
import type { Message, Part, TextPart, UserMessage } from "@opencode-ai/sdk";

/**
 * Helper to create a mock message with given parts
 */
function makeMessage(
  index: number,
  parts: Part[],
  role: "user" | "assistant" = "user"
): { info: Message; parts: Part[] } {
  return {
    info: {
      id: `msg-${index}`,
      sessionID: "session-1",
      role,
      time: { created: Date.now() + index },
      agent: "agent-1",
      model: { providerID: "provider-1", modelID: "model-1" },
    } as UserMessage,
    parts,
  };
}

function textPart(index: number, text: string): TextPart {
  return {
    id: `part-${index}`,
    sessionID: "session-1",
    messageID: `msg-${index}`,
    type: "text",
    text,
  };
}

function toolPart(index: number, toolName: string, output: string): Part {
  return {
    id: `tool-${index}`,
    sessionID: "session-1",
    messageID: `msg-${index}`,
    type: "tool",
    tool: toolName,
    output,
  } as unknown as Part;
}

function filePart(index: number, path: string, content: string): Part {
  return {
    id: `file-${index}`,
    sessionID: "session-1",
    messageID: `msg-${index}`,
    type: "file",
    path,
    content,
  } as unknown as Part;
}

function reasoningPart(index: number, text: string): Part {
  return {
    id: `reasoning-${index}`,
    sessionID: "session-1",
    messageID: `msg-${index}`,
    type: "reasoning",
    text,
  } as unknown as Part;
}

/**
 * Build a large text to simulate high token counts
 */
function largeText(chars: number): string {
  return "x".repeat(chars);
}

/**
 * Create mock PluginInput with spyable toast
 */
function createMockInput(): PluginInput {
  const toastCalls: Array<{ title?: string; message: string; variant?: string }> = [];

  const input = {
    client: {
      tui: {
        showToast: vi.fn(async (options: any) => {
          toastCalls.push({
            title: options.body?.title,
            message: options.body?.message,
            variant: options.body?.variant,
          });
          return { data: true };
        }),
      },
    },
    project: { id: "project-1", worktree: "/tmp", time: { created: 0 } },
    directory: "/tmp",
    worktree: "/tmp",
    experimental_workspace: { register: vi.fn() },
    serverUrl: new URL("http://localhost:3000"),
    $: {} as any,
  } as unknown as PluginInput;

  return Object.assign(input, { _toastCalls: toastCalls });
}

/**
 * Run the compactor transform hook on a message array
 */
async function runTransform(
  messages: { info: Message; parts: Part[] }[],
  options: Record<string, unknown> = {},
  inputOverrides: Partial<PluginInput> = {}
): Promise<{
  result: { info: Message; parts: Part[] }[];
  toastCalls: Array<{ title?: string; message: string; variant?: string }>;
}> {
  const input = createMockInput();
  Object.assign(input, inputOverrides);

  const hooks = await ContextCompactorPlugin(input, options);
  const output = { messages: [...messages] };
  await hooks["experimental.chat.messages.transform"]!({}, output);

  return {
    result: output.messages,
    toastCalls: (input as any)._toastCalls,
  };
}

describe("ContextCompactorPlugin", () => {
  describe("message count threshold (compact_after_messages)", () => {
    it("does nothing when total messages are below compact_after_messages", async () => {
      const messages = Array.from({ length: 50 }, (_, i) =>
        makeMessage(i, [textPart(i, `Message ${i}`)])
      );

      const { result, toastCalls } = await runTransform(messages, {
        compact_after_messages: 100,
      });

      expect(result).toHaveLength(50);
      expect(result).toEqual(messages);
      expect(toastCalls).toHaveLength(0);
    });

    it("compacts when total messages reach compact_after_messages", async () => {
      const messages = Array.from({ length: 105 }, (_, i) =>
        makeMessage(i, [textPart(i, `Message ${i}`)])
      );

      const { result, toastCalls } = await runTransform(messages, {
        compact_after_messages: 100,
        keep_messages: 10,
      });

      // First + summary + last 10 = 12 messages
      expect(result).toHaveLength(12);
      expect(toastCalls).toHaveLength(2);
      expect(toastCalls[0].variant).toBe("info");
      expect(toastCalls[1].variant).toBe("success");
    });
  });

  describe("context token threshold (context_threshold)", () => {
    it("does nothing when context_threshold > 0 but total tokens are below it", async () => {
      // 105 short messages (~10 tokens each = ~1050 total, well below 50k)
      const messages = Array.from({ length: 105 }, (_, i) =>
        makeMessage(i, [textPart(i, `Short msg ${i}`)])
      );

      const { result, toastCalls } = await runTransform(messages, {
        compact_after_messages: 100,
        context_threshold: 50000,
        keep_messages: 10,
      });

      expect(result).toHaveLength(105);
      expect(toastCalls).toHaveLength(0);
    });

    it("compacts when both message count AND token thresholds are met", async () => {
      // 105 messages with large text (~2000 chars each = ~500 tokens × 105 ≈ 52,500 tokens)
      const messages = Array.from({ length: 105 }, (_, i) =>
        makeMessage(i, [
          textPart(i, largeText(2000)),
        ])
      );

      const { result, toastCalls } = await runTransform(messages, {
        compact_after_messages: 100,
        context_threshold: 50000,
        keep_messages: 10,
      });

      expect(result.length).toBeLessThan(105);
      expect(toastCalls).toHaveLength(2);
      expect(toastCalls[0].message).toContain("tokens total");
    });

    it("compacts on message count alone when context_threshold is 0", async () => {
      const messages = Array.from({ length: 105 }, (_, i) =>
        makeMessage(i, [textPart(i, `Short msg ${i}`)])
      );

      const { result, toastCalls } = await runTransform(messages, {
        compact_after_messages: 100,
        context_threshold: 0,
        keep_messages: 10,
      });

      expect(result).toHaveLength(12);
      expect(toastCalls).toHaveLength(2);
    });
  });

  describe("stripping non-text parts", () => {
    it("removes tool, file, reasoning parts from middle messages", async () => {
      const messages = Array.from({ length: 105 }, (_, i) => {
        if (i === 0) {
          return makeMessage(i, [textPart(i, "First message")]);
        }
        return makeMessage(i, [
          textPart(i, `Text ${i}`),
          toolPart(i, "read_file", "file content"),
          filePart(i, "/path/to/file", "content"),
          reasoningPart(i, "thinking..."),
        ]);
      });

      const { result } = await runTransform(messages, {
        compact_after_messages: 100,
        context_threshold: 0,
        keep_messages: 10,
      });

      // Summary message should only contain text, no tool/file/reasoning parts
      const summaryMsg = result[1];
      expect(summaryMsg.parts).toHaveLength(1);
      expect(summaryMsg.parts[0].type).toBe("text");
      expect((summaryMsg.parts[0] as TextPart).text).toContain("Previous context");

      // Last 10 messages should be preserved intact
      const lastPreserved = result.slice(-10);
      for (const msg of lastPreserved) {
        expect(msg.parts).toHaveLength(4); // original parts preserved
      }
    });

    it("preserves only text parts in summary even if middle messages have no text", async () => {
      const messages = Array.from({ length: 105 }, (_, i) => {
        if (i === 0) {
          return makeMessage(i, [textPart(i, "First")]);
        }
        return makeMessage(i, [
          toolPart(i, "cmd", "output"),
          filePart(i, "/f", "c"),
        ]);
      });

      const { result, toastCalls } = await runTransform(messages, {
        compact_after_messages: 100,
        context_threshold: 0,
        keep_messages: 10,
      });

      // Middle messages have no text, so just first + last 10 are kept
      expect(toastCalls[1].message).toContain("no text to summarize");
      expect(result).toHaveLength(11); // first + last 10 (no summary inserted)
    });
  });

  describe("message structure preservation", () => {
    it("preserves the first message exactly", async () => {
      const firstMsg = makeMessage(0, [
        textPart(0, "System prompt"),
        toolPart(0, "setup", "done"),
      ]);
      const messages = [
        firstMsg,
        ...Array.from({ length: 104 }, (_, i) =>
          makeMessage(i + 1, [textPart(i + 1, `Message ${i + 1}`)])
        ),
      ];

      const { result } = await runTransform(messages, {
        compact_after_messages: 100,
        context_threshold: 0,
        keep_messages: 10,
      });

      expect(result[0]).toEqual(firstMsg);
    });

    it("preserves the last N messages exactly", async () => {
      const messages = Array.from({ length: 105 }, (_, i) =>
        makeMessage(i, [
          textPart(i, `Msg ${i}`),
          toolPart(i, "tool", `output ${i}`),
        ])
      );

      const { result } = await runTransform(messages, {
        compact_after_messages: 100,
        context_threshold: 0,
        keep_messages: 10,
      });

      const lastOriginal = messages.slice(-10);
      const lastResult = result.slice(-10);

      expect(lastResult).toEqual(lastOriginal);
    });

    it("creates a synthetic summary message with correct structure", async () => {
      const messages = Array.from({ length: 105 }, (_, i) =>
        makeMessage(i, [textPart(i, `Content ${i}`)])
      );

      const { result } = await runTransform(messages, {
        compact_after_messages: 100,
        context_threshold: 0,
        keep_messages: 10,
      });

      const summaryMsg = result[1];
      expect(summaryMsg.info.role).toBe("user");
      expect(summaryMsg.parts[0].type).toBe("text");
      expect((summaryMsg.parts[0] as TextPart).synthetic).toBe(true);
      expect((summaryMsg.parts[0] as TextPart).text).toContain("📋 Previous context");
    });
  });

  describe("summary modes", () => {
    it("concatenate mode joins all text with separators", async () => {
      const messages = Array.from({ length: 105 }, (_, i) =>
        makeMessage(i, [textPart(i, `Line ${i}`)])
      );

      const { result } = await runTransform(messages, {
        compact_after_messages: 100,
        context_threshold: 0,
        keep_messages: 10,
        mode: "concatenate",
      });

      const summaryText = (result[1].parts[0] as TextPart).text;
      expect(summaryText).toContain("Previous context");
      expect(summaryText).toContain("Line 1");
      expect(summaryText).toContain("---");
    });

    it("summarize mode truncates when text exceeds threshold", async () => {
      const messages = Array.from({ length: 105 }, (_, i) =>
        makeMessage(i, [textPart(i, largeText(100))]) // ~25 tokens each x 103 = ~2575 tokens
      );

      const { result } = await runTransform(messages, {
        compact_after_messages: 100,
        context_threshold: 0,
        keep_messages: 10,
        mode: "summarize",
        token_threshold: 100, // Force truncation
      });

      const summaryText = (result[1].parts[0] as TextPart).text;
      expect(summaryText).toContain("summarized");
      expect(summaryText).toContain("...");
    });

    it("hybrid mode concatenates when under token threshold", async () => {
      const messages = Array.from({ length: 105 }, (_, i) =>
        makeMessage(i, [textPart(i, `Short ${i}`)])
      );

      const { result } = await runTransform(messages, {
        compact_after_messages: 100,
        context_threshold: 0,
        keep_messages: 10,
        mode: "hybrid",
        token_threshold: 10000,
      });

      const summaryText = (result[1].parts[0] as TextPart).text;
      expect(summaryText).not.toContain("summarized");
      expect(summaryText).not.toContain("...");
    });
  });

  describe("toast notifications", () => {
    it("shows compacting and compacted toasts on success", async () => {
      const messages = Array.from({ length: 105 }, (_, i) =>
        makeMessage(i, [textPart(i, `Text ${i}`)])
      );

      const { toastCalls } = await runTransform(messages, {
        compact_after_messages: 100,
        context_threshold: 0,
        keep_messages: 10,
      });

      expect(toastCalls).toHaveLength(2);
      expect(toastCalls[0].title).toBe("Compacting context");
      expect(toastCalls[0].variant).toBe("info");
      expect(toastCalls[1].title).toBe("Context compacted");
      expect(toastCalls[1].variant).toBe("success");
      expect(toastCalls[1].message).toContain("tokens saved");
    });

    it("does not break when toast fails", async () => {
      const failingInput = {
        client: {
          tui: {
            showToast: vi.fn(async () => {
              throw new Error("Toast failed");
            }),
          },
        },
        project: { id: "project-1", worktree: "/tmp", time: { created: 0 } },
        directory: "/tmp",
        worktree: "/tmp",
        experimental_workspace: { register: vi.fn() },
        serverUrl: new URL("http://localhost:3000"),
        $: {} as any,
      } as unknown as PluginInput;

      const messages = Array.from({ length: 105 }, (_, i) =>
        makeMessage(i, [textPart(i, `Text ${i}`)])
      );

      const hooks = await ContextCompactorPlugin(failingInput, {
        compact_after_messages: 100,
        context_threshold: 0,
        keep_messages: 10,
      });

      const output = { messages: [...messages] };
      // Should not throw even though toast fails
      await expect(
        hooks["experimental.chat.messages.transform"]!({}, output)
      ).resolves.not.toThrow();

      expect(output.messages.length).toBe(12);
    });
  });

  describe("edge cases", () => {
    it("handles empty messages array", async () => {
      const { result, toastCalls } = await runTransform([], {
        compact_after_messages: 100,
      });

      expect(result).toHaveLength(0);
      expect(toastCalls).toHaveLength(0);
    });

    it("handles single message", async () => {
      const { result, toastCalls } = await runTransform(
        [makeMessage(0, [textPart(0, "Only message")])],
        { compact_after_messages: 100 }
      );

      expect(result).toHaveLength(1);
      expect(toastCalls).toHaveLength(0);
    });

    it("handles keep_messages larger than total messages (first msg may duplicate)", async () => {
      const messages = Array.from({ length: 105 }, (_, i) =>
        makeMessage(i, [textPart(i, `Text ${i}`)])
      );

      const { result, toastCalls } = await runTransform(messages, {
        compact_after_messages: 100,
        context_threshold: 0,
        keep_messages: 200, // More than total messages
      });

      // When keep_messages > total: lastMessages = all, middle = empty
      // Result = [first] + [all] = first message duplicated
      expect(result.length).toBe(106);
      expect(toastCalls.length).toBeLessThanOrEqual(2);
    });

    it("correctly calculates token savings in toast", async () => {
      const messages = Array.from({ length: 105 }, (_, i) =>
        makeMessage(i, [
          textPart(i, largeText(1000)), // ~250 tokens each x 103 middle = ~25750
        ])
      );

      const { toastCalls } = await runTransform(messages, {
        compact_after_messages: 100,
        context_threshold: 0,
        keep_messages: 10,
      });

      const successToast = toastCalls.find((t) => t.variant === "success");
      expect(successToast).toBeDefined();
      expect(successToast!.message).toMatch(/~[\d,]+ tokens saved/);
    });
  });
});
