import { beforeEach, describe, expect, it, vi } from "vitest";
import { pinnedMessageManager } from "../../src/pinned/manager.js";
import {
  __resetSettingsForTests,
  setCurrentProject,
  setCurrentModel,
} from "../../src/settings/manager.js";

const opencodeMocks = vi.hoisted(() => ({
  providers: vi.fn(),
  diff: vi.fn(),
  get: vi.fn(),
  messages: vi.fn(),
}));

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: {
    config: {
      providers: opencodeMocks.providers,
    },
    session: {
      diff: opencodeMocks.diff,
      get: opencodeMocks.get,
      messages: opencodeMocks.messages,
    },
  },
}));

function createApi() {
  let nextId = 100;
  return {
    sendMessage: vi.fn().mockImplementation(async () => ({ message_id: nextId++ })),
    pinChatMessage: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
    unpinChatMessage: vi.fn().mockResolvedValue(true),
    deleteMessage: vi.fn().mockResolvedValue(true),
  };
}

describe("pinned manager scoped state", () => {
  beforeEach(() => {
    __resetSettingsForTests();
    (pinnedMessageManager as unknown as { contexts: Map<string, unknown> }).contexts = new Map();
    opencodeMocks.providers.mockReset();
    opencodeMocks.diff.mockReset();
    opencodeMocks.get.mockReset();
    opencodeMocks.messages.mockReset();
    opencodeMocks.providers.mockResolvedValue({
      data: {
        providers: [
          {
            id: "openai",
            models: {
              "gpt-5": { limit: { context: 400000 } },
            },
          },
        ],
      },
      error: null,
    });
    opencodeMocks.diff.mockResolvedValue({ data: [], error: null });
    opencodeMocks.get.mockResolvedValue({ data: null, error: null });
    opencodeMocks.messages.mockResolvedValue({ data: [], error: null });
  });

  it("creates separate pinned messages for different thread scopes", async () => {
    const api = createApi();

    setCurrentProject({ id: "p1", worktree: "/repo/a" }, "chat:-1:10");
    setCurrentModel({ providerID: "openai", modelID: "gpt-5", variant: "default" }, "chat:-1:10");
    setCurrentProject({ id: "p2", worktree: "/repo/b" }, "chat:-1:20");
    setCurrentModel({ providerID: "openai", modelID: "gpt-5", variant: "default" }, "chat:-1:20");

    pinnedMessageManager.initialize(api as never, -1, "chat:-1:10", 10);
    pinnedMessageManager.initialize(api as never, -1, "chat:-1:20", 20);

    await pinnedMessageManager.onSessionChange("s1", "thread 10", "chat:-1:10");
    await pinnedMessageManager.onSessionChange("s2", "thread 20", "chat:-1:20");

    expect(api.sendMessage).toHaveBeenCalledTimes(2);
    expect(api.sendMessage).toHaveBeenNthCalledWith(
      1,
      -1,
      expect.any(String),
      expect.objectContaining({ message_thread_id: 10 }),
    );
    expect(api.sendMessage).toHaveBeenNthCalledWith(
      2,
      -1,
      expect.any(String),
      expect.objectContaining({ message_thread_id: 20 }),
    );

    const stateA = pinnedMessageManager.getState("chat:-1:10");
    const stateB = pinnedMessageManager.getState("chat:-1:20");
    expect(stateA.messageId).not.toBeNull();
    expect(stateB.messageId).not.toBeNull();
    expect(stateA.messageId).not.toBe(stateB.messageId);
  });

  it("uses thread id from scope key when explicit thread id is missing", async () => {
    const api = createApi();

    setCurrentProject({ id: "p1", worktree: "/repo/a" }, "-1:77");
    setCurrentModel({ providerID: "openai", modelID: "gpt-5", variant: "default" }, "-1:77");

    pinnedMessageManager.initialize(api as never, -1, "-1:77", null);
    await pinnedMessageManager.onSessionChange("s1", "thread 77", "-1:77");

    expect(api.sendMessage).toHaveBeenCalledWith(
      -1,
      expect.any(String),
      expect.objectContaining({ message_thread_id: 77 }),
    );
  });

  it("loads assistant cost from history into the scoped pinned message", async () => {
    const api = createApi();

    setCurrentProject({ id: "p1", worktree: "/repo/a" }, "chat:-1:10");
    setCurrentModel({ providerID: "openai", modelID: "gpt-5", variant: "default" }, "chat:-1:10");
    opencodeMocks.messages.mockResolvedValue({
      data: [
        {
          info: {
            role: "assistant",
            cost: 0.01234,
            tokens: { input: 1200, cache: { read: 300 } },
          },
        },
        {
          info: {
            role: "assistant",
            cost: 0.00056,
            tokens: { input: 900, cache: { read: 25 } },
          },
        },
      ],
      error: null,
    });

    pinnedMessageManager.initialize(api as never, -1, "chat:-1:10", 10);
    await pinnedMessageManager.onSessionChange("s1", "thread 10", "chat:-1:10");

    expect(api.sendMessage).toHaveBeenCalledWith(
      -1,
      expect.stringContaining("Cost: $0.00"),
      expect.objectContaining({ message_thread_id: 10 }),
    );
    expect(api.editMessageText).toHaveBeenCalledWith(
      -1,
      100,
      expect.stringContaining("Cost: $0.013"),
    );

    expect(pinnedMessageManager.getState("chat:-1:10")).toEqual(
      expect.objectContaining({
        assistantCost: 0.0129,
        tokensUsed: 1500,
      }),
    );
  });

  it("updates pinned state during a run but only edits on explicit flush", async () => {
    const api = createApi();

    setCurrentProject({ id: "p1", worktree: "/repo/a" }, "chat:-1:10");
    setCurrentModel({ providerID: "openai", modelID: "gpt-5", variant: "default" }, "chat:-1:10");

    pinnedMessageManager.initialize(api as never, -1, "chat:-1:10", 10);
    await pinnedMessageManager.onSessionChange("s1", "thread 10", "chat:-1:10");
    api.editMessageText.mockClear();

    await pinnedMessageManager.onMessageComplete(
      { input: 100, output: 10, reasoning: 0, cacheRead: 20, cacheWrite: 0, cost: 0.01 },
      "chat:-1:10",
    );
    pinnedMessageManager.addFileChange(
      { file: "/repo/a/a.ts", additions: 1, deletions: 0 },
      "chat:-1:10",
    );

    expect(api.editMessageText).not.toHaveBeenCalled();

    await pinnedMessageManager.flush("chat:-1:10");

    expect(api.editMessageText).toHaveBeenCalledTimes(1);
  });

  it("reloads context from history after compaction", async () => {
    const api = createApi();

    setCurrentProject({ id: "p1", worktree: "/repo/a" }, "chat:-1:10");
    setCurrentModel({ providerID: "openai", modelID: "gpt-5", variant: "default" }, "chat:-1:10");
    pinnedMessageManager.initialize(api as never, -1, "chat:-1:10", 10);
    await pinnedMessageManager.onSessionChange("s1", "thread 10", "chat:-1:10");

    opencodeMocks.messages.mockResolvedValueOnce({
      data: [
        {
          info: {
            role: "assistant",
            cost: 0.02,
            tokens: { input: 5000, cache: { read: 250 } },
          },
        },
      ],
      error: null,
    });

    await pinnedMessageManager.onSessionCompacted("s1", "/repo/a", "chat:-1:10");

    const state = pinnedMessageManager.getState("chat:-1:10");
    expect(state).toEqual(
      expect.objectContaining({
        tokensUsed: 5250,
        assistantCost: expect.closeTo(0.02, 5),
      }),
    );
  });

  it("includes summary messages when reloading context after compaction", async () => {
    const api = createApi();

    setCurrentProject({ id: "p1", worktree: "/repo/a" }, "chat:-1:10");
    setCurrentModel({ providerID: "openai", modelID: "gpt-5", variant: "default" }, "chat:-1:10");
    pinnedMessageManager.initialize(api as never, -1, "chat:-1:10", 10);
    await pinnedMessageManager.onSessionChange("s1", "thread 10", "chat:-1:10");

    opencodeMocks.messages.mockResolvedValueOnce({
      data: [
        {
          info: {
            role: "assistant",
            summary: true,
            cost: 0.005,
            tokens: { input: 800, cache: { read: 120 } },
          },
        },
      ],
      error: null,
    });

    await pinnedMessageManager.onSessionCompacted("s1", "/repo/a", "chat:-1:10");

    expect(pinnedMessageManager.getState("chat:-1:10")).toEqual(
      expect.objectContaining({
        tokensUsed: 920,
        assistantCost: expect.closeTo(0.005, 5),
      }),
    );
  });
});
