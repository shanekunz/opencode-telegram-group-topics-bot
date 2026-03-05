import { beforeEach, describe, expect, it, vi } from "vitest";
import { pinnedMessageManager } from "../../src/pinned/manager.js";
import {
  __resetSettingsForTests,
  setCurrentProject,
  setCurrentModel,
} from "../../src/settings/manager.js";

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: {
    config: {
      providers: vi.fn().mockResolvedValue({
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
      }),
    },
    session: {
      diff: vi.fn().mockResolvedValue({ data: [], error: null }),
      get: vi.fn().mockResolvedValue({ data: null, error: null }),
      messages: vi.fn().mockResolvedValue({ data: [], error: null }),
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
});
