import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@opencode-ai/sdk/v2";
import { summaryAggregator } from "../../src/summary/aggregator.js";

const mocked = vi.hoisted(() => ({
  getCurrentProjectMock: vi.fn(),
}));

vi.mock("../../src/settings/manager.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/settings/manager.js")>(
    "../../src/settings/manager.js",
  );

  return {
    ...actual,
    getCurrentProject: mocked.getCurrentProjectMock,
  };
});

describe("summary/aggregator", () => {
  beforeEach(() => {
    mocked.getCurrentProjectMock.mockReset();
    mocked.getCurrentProjectMock.mockReturnValue({ id: "p1", worktree: "D:/repo", name: "repo" });
    summaryAggregator.clear();
    summaryAggregator.setOnCleared(() => {});
    summaryAggregator.setOnTool(() => {});
    summaryAggregator.setOnToolFile(() => {});
    summaryAggregator.setOnMessageUpdated(() => {});
    summaryAggregator.setOnThinking(() => {});
    summaryAggregator.setOnSessionIdle(() => {});
    summaryAggregator.setOnSessionError(() => {});
    summaryAggregator.setOnSessionRetry(() => {});
  });

  it("invokes onCleared callback when aggregator is cleared", () => {
    const onCleared = vi.fn();
    summaryAggregator.setOnCleared(onCleared);

    summaryAggregator.clear();

    expect(onCleared).toHaveBeenCalledTimes(1);
  });

  it("includes sessionId in tool callback payload", () => {
    const onTool = vi.fn();
    summaryAggregator.setOnTool(onTool);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-1",
          sessionID: "session-1",
          messageID: "message-1",
          type: "tool",
          callID: "call-1",
          tool: "bash",
          state: {
            status: "completed",
            input: {
              command: "npm test",
            },
            metadata: {},
          },
        },
      },
    } as unknown as Event);

    expect(onTool).toHaveBeenCalledTimes(1);
    expect(onTool.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        sessionId: "session-1",
        callId: "call-1",
        tool: "bash",
        hasFileAttachment: false,
        state: expect.objectContaining({ status: "completed" }),
      }),
    );
  });

  it("streams assistant text snapshots while a message is in progress", () => {
    const onMessageUpdated = vi.fn();
    summaryAggregator.setOnMessageUpdated(onMessageUpdated);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-stream",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-stream-1",
          sessionID: "session-1",
          messageID: "message-stream",
          type: "text",
          text: "Hello",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-stream-2",
          sessionID: "session-1",
          messageID: "message-stream",
          type: "text",
          text: " world",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    expect(onMessageUpdated.mock.calls).toEqual([
      ["session-1", "Hello"],
      ["session-1", "Hello world"],
    ]);
  });

  it("emits tool updates for running and error states once each", () => {
    const onTool = vi.fn();
    summaryAggregator.setOnTool(onTool);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-tool-states",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    const runningEvent = {
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-tool-running",
          sessionID: "session-1",
          messageID: "message-tool-states",
          type: "tool",
          callID: "call-tool-states",
          tool: "bash",
          state: {
            status: "running",
            input: { command: "npm test" },
            metadata: {},
          },
        },
      },
    } as unknown as Event;

    summaryAggregator.processEvent(runningEvent);
    summaryAggregator.processEvent(runningEvent);
    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-tool-error",
          sessionID: "session-1",
          messageID: "message-tool-states",
          type: "tool",
          callID: "call-tool-states",
          tool: "bash",
          state: {
            status: "error",
            input: { command: "npm test" },
            metadata: {},
          },
        },
      },
    } as unknown as Event);

    expect(onTool).toHaveBeenCalledTimes(2);
    expect(onTool.mock.calls[0][0]).toEqual(
      expect.objectContaining({ state: expect.objectContaining({ status: "running" }) }),
    );
    expect(onTool.mock.calls[1][0]).toEqual(
      expect.objectContaining({ state: expect.objectContaining({ status: "error" }) }),
    );
  });

  it("tracks subagent lifecycle for child sessions", () => {
    const onSubagent = vi.fn();
    summaryAggregator.setOnSubagent(onSubagent);
    summaryAggregator.setSession("root-session");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "subtask-1",
          sessionID: "root-session",
          messageID: "message-1",
          type: "subtask",
          agent: "explore",
          description: "Inspect sync conflicts",
          prompt: "Inspect sync conflicts",
          command: "/fork-sync",
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "session.created",
      properties: {
        info: {
          id: "child-session",
          parentID: "root-session",
          title: "Inspect sync conflicts (@explore subagent)",
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "child-tool-1",
          sessionID: "child-session",
          messageID: "child-message-1",
          type: "tool",
          callID: "child-call-1",
          tool: "read",
          state: {
            status: "running",
            input: { filePath: "src/summary/aggregator.ts" },
            metadata: {},
          },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "session.idle",
      properties: {
        sessionID: "child-session",
      },
    } as unknown as Event);

    const lastCall = onSubagent.mock.calls[onSubagent.mock.calls.length - 1]?.[1];
    expect(lastCall).toEqual([
      expect.objectContaining({
        sessionId: "child-session",
        parentSessionId: "root-session",
        agent: "explore",
        description: "Inspect sync conflicts",
        status: "completed",
      }),
    ]);
  });

  it("marks child session subagents as failed on session.error", () => {
    const onSubagent = vi.fn();
    summaryAggregator.setOnSubagent(onSubagent);
    summaryAggregator.setSession("root-session");

    summaryAggregator.processEvent({
      type: "session.created",
      properties: {
        info: {
          id: "child-session",
          parentID: "root-session",
          title: "Investigate (@general subagent)",
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "session.error",
      properties: {
        sessionID: "child-session",
        error: { message: "subagent crashed" },
      },
    } as unknown as Event);

    const lastCall = onSubagent.mock.calls[onSubagent.mock.calls.length - 1]?.[1];
    expect(lastCall).toEqual([
      expect.objectContaining({
        sessionId: "child-session",
        status: "error",
        terminalMessage: "subagent crashed",
      }),
    ]);
  });

  it("does not guess unknown child-session ownership when multiple pending subagents exist", () => {
    const onSubagent = vi.fn();
    summaryAggregator.setOnSubagent(onSubagent);
    summaryAggregator.setSession("root-a");
    summaryAggregator.setSession("root-b");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "subtask-a",
          sessionID: "root-a",
          messageID: "message-a",
          type: "subtask",
          agent: "explore",
          description: "Task A",
          prompt: "Task A",
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "subtask-b",
          sessionID: "root-b",
          messageID: "message-b",
          type: "subtask",
          agent: "general",
          description: "Task B",
          prompt: "Task B",
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "child-message",
          sessionID: "child-unknown",
          role: "assistant",
          providerID: "openai",
          modelID: "gpt-5",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    const rootACall = onSubagent.mock.calls.find((call) => call[0] === "root-a");
    const rootBCall = onSubagent.mock.calls.find((call) => call[0] === "root-b");

    expect(rootACall?.[1]).toEqual([
      expect.objectContaining({
        sessionId: null,
        parentSessionId: "root-a",
        description: "Task A",
      }),
    ]);
    expect(rootBCall?.[1]).toEqual([
      expect.objectContaining({
        sessionId: null,
        parentSessionId: "root-b",
        description: "Task B",
      }),
    ]);
  });

  it("marks write tool without file attachment when payload is oversized", () => {
    const onTool = vi.fn();
    const onToolFile = vi.fn();
    summaryAggregator.setOnTool(onTool);
    summaryAggregator.setOnToolFile(onToolFile);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-oversized",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-oversized",
          sessionID: "session-1",
          messageID: "message-oversized",
          type: "tool",
          callID: "call-oversized",
          tool: "write",
          state: {
            status: "completed",
            input: {
              filePath: "src/huge.ts",
              content: "x".repeat(101 * 1024),
            },
            metadata: {},
          },
        },
      },
    } as unknown as Event);

    expect(onTool).toHaveBeenCalledTimes(1);
    expect(onTool.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        tool: "write",
        hasFileAttachment: false,
      }),
    );
    expect(onToolFile).not.toHaveBeenCalled();
  });

  it("passes sessionId to thinking callback when reasoning part arrives", async () => {
    const onThinking = vi.fn();
    summaryAggregator.setOnThinking(onThinking);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-reasoning-1",
          sessionID: "session-1",
          messageID: "message-1",
          type: "reasoning",
          text: "Let me think about this...",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onThinking).toHaveBeenCalledWith("session-1");
  });

  it("does not send thinking callback when no reasoning part arrives", async () => {
    const onThinking = vi.fn();
    summaryAggregator.setOnThinking(onThinking);
    summaryAggregator.setSession("session-1");

    // Only a message.updated event without any reasoning part — should NOT trigger thinking
    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-no-reasoning",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-text-1",
          sessionID: "session-1",
          messageID: "message-no-reasoning",
          type: "text",
          text: "Here is my answer.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onThinking).not.toHaveBeenCalled();
  });

  it("fires thinking callback only once per message even with multiple reasoning parts", async () => {
    const onThinking = vi.fn();
    summaryAggregator.setOnThinking(onThinking);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-multi-reasoning",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    for (let i = 0; i < 3; i++) {
      summaryAggregator.processEvent({
        type: "message.part.updated",
        properties: {
          part: {
            id: `part-reasoning-${i}`,
            sessionID: "session-1",
            messageID: "message-multi-reasoning",
            type: "reasoning",
            text: `Thinking step ${i}`,
            time: { start: Date.now() },
          },
        },
      } as unknown as Event);
    }

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onThinking).toHaveBeenCalledTimes(1);
    expect(onThinking).toHaveBeenCalledWith("session-1");
  });

  it("reports session.error message through callback", async () => {
    const onSessionError = vi.fn();
    summaryAggregator.setOnSessionError(onSessionError);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "session.error",
      properties: {
        sessionID: "session-1",
        error: {
          name: "UnknownError",
          data: {
            message: "Model not found: opencode/foo.",
          },
        },
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onSessionError).toHaveBeenCalledWith("session-1", "Model not found: opencode/foo.");
  });

  it("reports assistant cost with completed message tokens", () => {
    const onTokens = vi.fn();
    summaryAggregator.setOnTokens(onTokens);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-cost",
          sessionID: "session-1",
          role: "assistant",
          cost: 0.01234,
          tokens: {
            input: 123,
            output: 45,
            reasoning: 6,
            cache: { read: 7, write: 8 },
          },
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    expect(onTokens).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        input: 123,
        output: 45,
        reasoning: 6,
        cacheRead: 7,
        cacheWrite: 8,
        cost: 0.01234,
      }),
    );
  });

  it("falls back to step-finish cost when message summary cost is missing", () => {
    const onTokens = vi.fn();
    summaryAggregator.setOnTokens(onTokens);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-step-cost",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-step-finish",
          sessionID: "session-1",
          messageID: "message-step-cost",
          type: "step-finish",
          reason: "done",
          cost: 0.0042,
          tokens: {
            input: 10,
            output: 11,
            reasoning: 12,
            cache: { read: 13, write: 14 },
          },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-step-cost",
          sessionID: "session-1",
          role: "assistant",
          tokens: {
            input: 123,
            output: 45,
            reasoning: 6,
            cache: { read: 7, write: 8 },
          },
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    expect(onTokens).toHaveBeenCalledWith("session-1", expect.objectContaining({ cost: 0.0042 }));
  });

  it("emits the full assistant message across all text parts", async () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    summaryAggregator.setOnComplete(onComplete);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-1",
          sessionID: "session-1",
          messageID: "message-1",
          type: "text",
          text: "Hello ",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-2",
          sessionID: "session-1",
          messageID: "message-1",
          type: "text",
          text: "world!",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.advanceTimersByTimeAsync(100);

    expect(onComplete).toHaveBeenCalledWith("session-1", "Hello world!");

    vi.useRealTimers();
  });

  it("waits for trailing text parts after message completion before emitting final text", async () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    summaryAggregator.setOnComplete(onComplete);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-2",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-a",
          sessionID: "session-1",
          messageID: "message-2",
          type: "text",
          text: "First",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-2",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.advanceTimersByTimeAsync(50);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-b",
          sessionID: "session-1",
          messageID: "message-2",
          type: "text",
          text: " second",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.advanceTimersByTimeAsync(100);

    expect(onComplete).toHaveBeenCalledWith("session-1", "First second");

    vi.useRealTimers();
  });

  it("reports session.idle through callback", async () => {
    const onSessionIdle = vi.fn();
    summaryAggregator.setOnSessionIdle(onSessionIdle);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "session.idle",
      properties: {
        sessionID: "session-1",
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onSessionIdle).toHaveBeenCalledWith("session-1");
  });

  it("keeps other typing indicators active when one session becomes idle", async () => {
    vi.useFakeTimers();
    const onTyping = vi.fn();
    summaryAggregator.setOnTypingIndicator(onTyping);
    summaryAggregator.setSession("session-1");
    summaryAggregator.setSession("session-2");

    const now = Date.now();
    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: now },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-2",
          sessionID: "session-2",
          role: "assistant",
          time: { created: now },
        },
      },
    } as unknown as Event);

    onTyping.mockClear();

    summaryAggregator.processEvent({
      type: "session.idle",
      properties: {
        sessionID: "session-1",
      },
    } as unknown as Event);

    await vi.advanceTimersByTimeAsync(4000);

    expect(onTyping).toHaveBeenCalledWith("session-2");
    expect(onTyping).not.toHaveBeenCalledWith("session-1");

    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("reports session.status retry through callback", async () => {
    const onSessionRetry = vi.fn();
    summaryAggregator.setOnSessionRetry(onSessionRetry);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "session.status",
      properties: {
        sessionID: "session-1",
        status: {
          type: "retry",
          attempt: 2,
          message: "Your current subscription plan does not yet include access to GLM-5",
          next: 1772203141283,
        },
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onSessionRetry).toHaveBeenCalledWith({
      sessionId: "session-1",
      attempt: 2,
      message: "Your current subscription plan does not yet include access to GLM-5",
      next: 1772203141283,
    });
  });

  it("sends apply_patch payload as tool file", () => {
    const onToolFile = vi.fn();
    summaryAggregator.setOnToolFile(onToolFile);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-1",
          sessionID: "session-1",
          messageID: "message-1",
          type: "tool",
          callID: "call-apply-patch",
          tool: "apply_patch",
          state: {
            status: "completed",
            input: {
              patchText: "irrelevant for formatter in this path",
            },
            metadata: {
              filediff: {
                file: "D:/repo/src/one.ts",
                additions: 2,
                deletions: 1,
              },
              diff: [
                "@@ -1,2 +1,3 @@",
                "--- a/src/one.ts",
                "+++ b/src/one.ts",
                " old",
                "-before",
                "+after",
                "+extra",
              ].join("\n"),
            },
          },
        },
      },
    } as unknown as Event);

    expect(onToolFile).toHaveBeenCalledTimes(1);

    const filePayload = onToolFile.mock.calls[0][0] as {
      sessionId: string;
      tool: string;
      hasFileAttachment: boolean;
      fileData: {
        filename: string;
        buffer: Buffer;
      };
    };

    expect(filePayload.sessionId).toBe("session-1");
    expect(filePayload.tool).toBe("apply_patch");
    expect(filePayload.hasFileAttachment).toBe(true);
    expect(filePayload.fileData.filename).toBe("edit_one.ts.txt");
    expect(filePayload.fileData.buffer.toString("utf8")).toContain("Edit File/Path: src/one.ts");
  });

  it("sends apply_patch file using title and patchText fallback", () => {
    const onToolFile = vi.fn();
    summaryAggregator.setOnToolFile(onToolFile);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-2",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-2",
          sessionID: "session-1",
          messageID: "message-2",
          type: "tool",
          callID: "call-apply-patch-fallback",
          tool: "apply_patch",
          state: {
            status: "completed",
            title: "Success. Updated the following files:\nM README.md",
            input: {
              patchText: [
                "--- a/README.md",
                "+++ b/README.md",
                "@@ -1,1 +1,2 @@",
                " old",
                "+new",
              ].join("\n"),
            },
            metadata: {},
          },
        },
      },
    } as unknown as Event);

    expect(onToolFile).toHaveBeenCalledTimes(1);

    const filePayload = onToolFile.mock.calls[0][0] as {
      hasFileAttachment: boolean;
      fileData: {
        filename: string;
        buffer: Buffer;
      };
    };

    expect(filePayload.hasFileAttachment).toBe(true);
    expect(filePayload.fileData.filename).toBe("edit_README.md.txt");
    expect(filePayload.fileData.buffer.toString("utf8")).toContain("Edit File/Path: README.md");
  });
});
