import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { handleAgentSelect } from "../../../src/bot/handlers/agent.js";

const mocked = vi.hoisted(() => ({
  ensureActiveInlineMenuMock: vi.fn(),
  clearActiveInlineMenuMock: vi.fn(),
  selectAgentMock: vi.fn(),
  getAvailableAgentsMock: vi.fn(),
  fetchCurrentAgentMock: vi.fn(),
  resolveProjectAgentMock: vi.fn(),
  getStoredModelMock: vi.fn(),
  formatVariantForButtonMock: vi.fn(),
  createMainKeyboardMock: vi.fn(),
  pinnedGetContextLimitMock: vi.fn(),
  pinnedRefreshContextLimitMock: vi.fn(),
  pinnedGetContextInfoMock: vi.fn(),
  keyboardInitializeMock: vi.fn(),
  keyboardUpdateAgentMock: vi.fn(),
  keyboardUpdateModelMock: vi.fn(),
  keyboardUpdateContextMock: vi.fn(),
  keyboardGetContextInfoMock: vi.fn(),
  keyboardGetStateMock: vi.fn(),
  getScopeKeyFromContextMock: vi.fn(),
  getScopeFromContextMock: vi.fn(),
  getScopeFromKeyMock: vi.fn(),
  getThreadSendOptionsMock: vi.fn(),
  tMock: vi.fn(),
}));

vi.mock("../../../src/agent/manager.js", () => ({
  selectAgent: mocked.selectAgentMock,
  getAvailableAgents: mocked.getAvailableAgentsMock,
  fetchCurrentAgent: mocked.fetchCurrentAgentMock,
  resolveProjectAgent: mocked.resolveProjectAgentMock,
}));

vi.mock("../../../src/agent/types.js", () => ({
  getAgentDisplayName: vi.fn((agentName: string) => `Agent:${agentName}`),
}));

vi.mock("../../../src/model/manager.js", () => ({
  getStoredModel: mocked.getStoredModelMock,
}));

vi.mock("../../../src/variant/manager.js", () => ({
  formatVariantForButton: mocked.formatVariantForButtonMock,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../src/bot/utils/keyboard.js", () => ({
  createMainKeyboard: mocked.createMainKeyboardMock,
}));

vi.mock("../../../src/pinned/manager.js", () => ({
  pinnedMessageManager: {
    getContextLimit: mocked.pinnedGetContextLimitMock,
    refreshContextLimit: mocked.pinnedRefreshContextLimitMock,
    getContextInfo: mocked.pinnedGetContextInfoMock,
  },
}));

vi.mock("../../../src/keyboard/manager.js", () => ({
  keyboardManager: {
    initialize: mocked.keyboardInitializeMock,
    updateAgent: mocked.keyboardUpdateAgentMock,
    updateModel: mocked.keyboardUpdateModelMock,
    updateContext: mocked.keyboardUpdateContextMock,
    getContextInfo: mocked.keyboardGetContextInfoMock,
    getState: mocked.keyboardGetStateMock,
  },
}));

vi.mock("../../../src/bot/handlers/inline-menu.js", () => ({
  clearActiveInlineMenu: mocked.clearActiveInlineMenuMock,
  ensureActiveInlineMenu: mocked.ensureActiveInlineMenuMock,
  replyWithInlineMenu: vi.fn(),
}));

vi.mock("../../../src/i18n/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/i18n/index.js")>();
  return {
    ...actual,
    t: mocked.tMock,
  };
});

vi.mock("../../../src/bot/scope.js", () => ({
  SCOPE_CONTEXT: {
    GROUP_GENERAL: "group-general",
  },
  getScopeFromContext: mocked.getScopeFromContextMock,
  getScopeFromKey: mocked.getScopeFromKeyMock,
  getScopeKeyFromContext: mocked.getScopeKeyFromContextMock,
  getThreadSendOptions: mocked.getThreadSendOptionsMock,
}));

function createContext(data: string): Context {
  return {
    chat: { id: 777 },
    callbackQuery: {
      data,
      message: { message_id: 55 },
    } as Context["callbackQuery"],
    api: {},
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue({ message_id: 56 }),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

describe("bot/handlers/agent", () => {
  beforeEach(() => {
    mocked.ensureActiveInlineMenuMock.mockReset();
    mocked.clearActiveInlineMenuMock.mockReset();
    mocked.selectAgentMock.mockReset();
    mocked.resolveProjectAgentMock.mockReset();
    mocked.getStoredModelMock.mockReset();
    mocked.formatVariantForButtonMock.mockReset();
    mocked.createMainKeyboardMock.mockReset();
    mocked.pinnedGetContextLimitMock.mockReset();
    mocked.pinnedRefreshContextLimitMock.mockReset();
    mocked.pinnedGetContextInfoMock.mockReset();
    mocked.keyboardInitializeMock.mockReset();
    mocked.keyboardUpdateAgentMock.mockReset();
    mocked.keyboardUpdateModelMock.mockReset();
    mocked.keyboardUpdateContextMock.mockReset();
    mocked.keyboardGetContextInfoMock.mockReset();
    mocked.keyboardGetStateMock.mockReset();
    mocked.getScopeKeyFromContextMock.mockReset();
    mocked.getScopeFromContextMock.mockReset();
    mocked.getScopeFromKeyMock.mockReset();
    mocked.getThreadSendOptionsMock.mockReset();
    mocked.tMock.mockReset();

    mocked.ensureActiveInlineMenuMock.mockResolvedValue(true);
    mocked.resolveProjectAgentMock.mockResolvedValue("build");
    mocked.getStoredModelMock.mockReturnValue({
      providerID: "openai",
      modelID: "gpt-5",
      variant: "default",
    });
    mocked.formatVariantForButtonMock.mockReturnValue("Default");
    mocked.createMainKeyboardMock.mockReturnValue({ keyboard: [] });
    mocked.pinnedGetContextLimitMock.mockReturnValue(0);
    mocked.pinnedGetContextInfoMock.mockReturnValue(null);
    mocked.keyboardGetContextInfoMock.mockReturnValue(null);
    mocked.keyboardGetStateMock.mockReturnValue(undefined);
    mocked.getScopeKeyFromContextMock.mockReturnValue("scope-1");
    mocked.getScopeFromContextMock.mockReturnValue({ threadId: 99 });
    mocked.getScopeFromKeyMock.mockReturnValue({ context: "group-topic" });
    mocked.getThreadSendOptionsMock.mockImplementation((threadId: number | null) =>
      threadId === null ? {} : { message_thread_id: threadId },
    );
    mocked.tMock.mockImplementation((key: string, params?: Record<string, string>) =>
      params?.name ? `${key}:${params.name}` : key,
    );
  });

  it("reconciles the selected agent before persisting and updating the keyboard", async () => {
    const ctx = createContext("agent:missing-agent");

    const handled = await handleAgentSelect(ctx);

    expect(handled).toBe(true);
    expect(mocked.resolveProjectAgentMock).toHaveBeenCalledWith("missing-agent", "scope-1");
    expect(mocked.selectAgentMock).toHaveBeenCalledWith("build", "scope-1");
    expect(mocked.keyboardUpdateAgentMock).toHaveBeenCalledWith("build", "scope-1");
    expect(mocked.createMainKeyboardMock).toHaveBeenCalledWith(
      "build",
      { providerID: "openai", modelID: "gpt-5", variant: "default" },
      undefined,
      "Default",
      undefined,
    );
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: "agent.changed_callback:Agent:build",
    });
    expect(ctx.reply).toHaveBeenCalledWith("agent.changed_message:Agent:build", {
      message_thread_id: 99,
      reply_markup: { keyboard: [] },
    });
  });
});
