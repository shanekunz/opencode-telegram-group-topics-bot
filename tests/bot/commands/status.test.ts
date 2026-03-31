import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { statusCommand } from "../../../src/bot/commands/status.js";

const mocked = vi.hoisted(() => ({
  healthMock: vi.fn(),
  projectListMock: vi.fn(),
  sessionListMock: vi.fn(),
  getCurrentSessionMock: vi.fn(),
  getCurrentProjectMock: vi.fn(),
  isTtsEnabledMock: vi.fn(),
  fetchCurrentAgentMock: vi.fn(),
  fetchCurrentModelMock: vi.fn(),
  isRunningMock: vi.fn(),
  getUptimeMock: vi.fn(),
  getPidMock: vi.fn(),
  keyboardInitializeMock: vi.fn(),
  keyboardGetContextInfoMock: vi.fn(),
  keyboardUpdateContextMock: vi.fn(),
  keyboardGetKeyboardMock: vi.fn(),
  pinnedIsInitializedMock: vi.fn(),
  pinnedInitializeMock: vi.fn(),
  pinnedGetContextLimitMock: vi.fn(),
  pinnedRefreshContextLimitMock: vi.fn(),
  pinnedGetContextInfoMock: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    global: {
      health: mocked.healthMock,
    },
    project: {
      list: mocked.projectListMock,
    },
    session: {
      list: mocked.sessionListMock,
    },
  },
}));

vi.mock("../../../src/session/manager.js", () => ({
  getCurrentSession: mocked.getCurrentSessionMock,
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getCurrentProject: mocked.getCurrentProjectMock,
  isTtsEnabled: mocked.isTtsEnabledMock,
}));

vi.mock("../../../src/agent/manager.js", () => ({
  fetchCurrentAgent: mocked.fetchCurrentAgentMock,
}));

vi.mock("../../../src/model/manager.js", () => ({
  fetchCurrentModel: mocked.fetchCurrentModelMock,
}));

vi.mock("../../../src/process/manager.js", () => ({
  processManager: {
    isRunning: mocked.isRunningMock,
    getUptime: mocked.getUptimeMock,
    getPID: mocked.getPidMock,
  },
}));

vi.mock("../../../src/keyboard/manager.js", () => ({
  keyboardManager: {
    initialize: mocked.keyboardInitializeMock,
    getContextInfo: mocked.keyboardGetContextInfoMock,
    updateContext: mocked.keyboardUpdateContextMock,
    getKeyboard: mocked.keyboardGetKeyboardMock,
  },
}));

vi.mock("../../../src/pinned/manager.js", () => ({
  pinnedMessageManager: {
    isInitialized: mocked.pinnedIsInitializedMock,
    initialize: mocked.pinnedInitializeMock,
    getContextLimit: mocked.pinnedGetContextLimitMock,
    refreshContextLimit: mocked.pinnedRefreshContextLimitMock,
    getContextInfo: mocked.pinnedGetContextInfoMock,
  },
}));

describe("bot/commands/status", () => {
  beforeEach(() => {
    mocked.healthMock.mockReset();
    mocked.projectListMock.mockReset();
    mocked.sessionListMock.mockReset();
    mocked.getCurrentSessionMock.mockReset();
    mocked.getCurrentProjectMock.mockReset();
    mocked.isTtsEnabledMock.mockReset();
    mocked.fetchCurrentAgentMock.mockReset();
    mocked.fetchCurrentModelMock.mockReset();
    mocked.isRunningMock.mockReset();
    mocked.getUptimeMock.mockReset();
    mocked.getPidMock.mockReset();
    mocked.keyboardInitializeMock.mockReset();
    mocked.keyboardGetContextInfoMock.mockReset();
    mocked.keyboardUpdateContextMock.mockReset();
    mocked.keyboardGetKeyboardMock.mockReset();
    mocked.pinnedIsInitializedMock.mockReset();
    mocked.pinnedInitializeMock.mockReset();
    mocked.pinnedGetContextLimitMock.mockReset();
    mocked.pinnedRefreshContextLimitMock.mockReset();
    mocked.pinnedGetContextInfoMock.mockReset();

    mocked.healthMock.mockResolvedValue({ data: { healthy: true, version: "1.0.0" }, error: null });
    mocked.projectListMock.mockResolvedValue({ data: [{ id: "p1" }], error: null });
    mocked.sessionListMock.mockResolvedValue({ data: [{ id: "s1" }], error: null });
    mocked.getCurrentSessionMock.mockReturnValue({ id: "s1", title: "S", directory: "/repo" });
    mocked.getCurrentProjectMock.mockReturnValue({ id: "p1", worktree: "/repo", name: "Repo" });
    mocked.isTtsEnabledMock.mockReturnValue(true);
    mocked.fetchCurrentAgentMock.mockResolvedValue("build");
    mocked.fetchCurrentModelMock.mockReturnValue({ providerID: "openai", modelID: "gpt-5" });
    mocked.isRunningMock.mockReturnValue(false);
    mocked.getUptimeMock.mockReturnValue(null);
    mocked.getPidMock.mockReturnValue(null);
    mocked.keyboardGetContextInfoMock.mockReturnValue(null);
    mocked.keyboardGetKeyboardMock.mockReturnValue({ inline_keyboard: [] });
    mocked.pinnedIsInitializedMock.mockReturnValue(false);
    mocked.pinnedGetContextLimitMock.mockReturnValue(200000);
    mocked.pinnedRefreshContextLimitMock.mockResolvedValue(undefined);
    mocked.pinnedGetContextInfoMock.mockReturnValue(null);
  });

  it("routes group-thread status response to message thread", async () => {
    const replyMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      chat: { id: -100, type: "supergroup" },
      message: { text: "/status", message_thread_id: 55 },
      api: {},
      reply: replyMock,
    } as unknown as Context;

    await statusCommand(ctx as never);

    expect(replyMock).toHaveBeenCalledTimes(1);
    expect(replyMock.mock.calls[0]?.[1]).toMatchObject({ message_thread_id: 55 });
  });

  it("shows DM global overview via direct reply", async () => {
    const replyMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      chat: { id: 42, type: "private" },
      message: { text: "/status" },
      reply: replyMock,
      api: {},
    } as unknown as Context;

    await statusCommand(ctx as never);

    expect(replyMock).toHaveBeenCalledTimes(1);
    const message = replyMock.mock.calls[0]?.[0] as string;
    expect(message).toContain("DM");
    expect(message).toContain("Projects");
    expect(message).toContain("Sessions");
    expect(message).toContain("TTS");
  });
});
