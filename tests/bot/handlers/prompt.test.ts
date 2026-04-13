import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Context } from "grammy";
import {
  __resetQueuedPromptsForTests,
  consumePromptResponseMode,
  dispatchNextQueuedPrompt,
  processUserPrompt,
} from "../../../src/bot/handlers/prompt.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  getCurrentProjectMock: vi.fn(),
  isTtsEnabledMock: vi.fn(),
  getScheduledTaskTopicByChatAndThreadMock: vi.fn(),
  getCurrentSessionMock: vi.fn(),
  getStoredAgentMock: vi.fn(),
  getStoredModelMock: vi.fn(),
  getTopicBindingByScopeKeyMock: vi.fn(),
  safeBackgroundTaskMock: vi.fn(),
  sessionStatusMock: vi.fn(),
  sessionPromptAsyncMock: vi.fn(),
  assistantRunStateStartRunMock: vi.fn(),
  assistantRunStateClearRunMock: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      status: mocked.sessionStatusMock,
      create: vi.fn(),
      promptAsync: mocked.sessionPromptAsyncMock,
    },
  },
}));

vi.mock("../../../src/session/manager.js", () => ({
  clearSession: vi.fn(),
  getCurrentSession: mocked.getCurrentSessionMock,
  setCurrentSession: vi.fn(),
}));

vi.mock("../../../src/session/cache-manager.js", () => ({
  ingestSessionInfoForCache: vi.fn(),
  __resetSessionDirectoryCacheForTests: vi.fn(),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getCurrentProject: mocked.getCurrentProjectMock,
  isTtsEnabled: mocked.isTtsEnabledMock,
}));

vi.mock("../../../src/agent/manager.js", () => ({
  getStoredAgent: mocked.getStoredAgentMock,
  resolveProjectAgent: vi.fn(async (agent: string) => agent),
}));

vi.mock("../../../src/model/manager.js", () => ({
  getStoredModel: mocked.getStoredModelMock,
}));

vi.mock("../../../src/variant/manager.js", () => ({
  formatVariantForButton: vi.fn(),
}));

vi.mock("../../../src/bot/utils/keyboard.js", () => ({
  createMainKeyboard: vi.fn(),
}));

vi.mock("../../../src/keyboard/manager.js", () => ({
  keyboardManager: {
    initialize: vi.fn(),
    getContextInfo: vi.fn(),
  },
}));

vi.mock("../../../src/pinned/manager.js", () => ({
  pinnedMessageManager: {
    isInitialized: vi.fn(),
    initialize: vi.fn(),
    onSessionChange: vi.fn(),
    getContextLimit: vi.fn(),
    refreshContextLimit: vi.fn(),
    getContextInfo: vi.fn(),
    getState: vi.fn(() => ({ messageId: null })),
  },
}));

vi.mock("../../../src/summary/aggregator.js", () => ({
  summaryAggregator: {
    setSession: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock("../../../src/interaction/manager.js", () => ({
  interactionManager: {
    getSnapshot: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock("../../../src/interaction/cleanup.js", () => ({
  clearAllInteractionState: vi.fn(),
}));

vi.mock("../../../src/utils/safe-background-task.js", () => ({
  safeBackgroundTask: mocked.safeBackgroundTaskMock,
}));

vi.mock("../../../src/utils/error-format.js", () => ({
  formatErrorDetails: vi.fn(),
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../src/bot/scope.js", () => ({
  GLOBAL_SCOPE_KEY: "global",
  SCOPE_CONTEXT: {
    GROUP_TOPIC: "group-topic",
  },
  getScopeFromContext: vi.fn((ctx: Context) => ({
    key: "-100123:555",
    context: "group-topic",
    threadId: ctx.message?.message_thread_id ?? null,
  })),
  getThreadSendOptions: vi.fn((threadId: number | null) =>
    threadId === null ? {} : { message_thread_id: threadId },
  ),
}));

vi.mock("../../../src/bot/constants.js", () => ({
  BOT_I18N_KEY: {
    TOPIC_UNBOUND: "topic.unbound",
  },
  CHAT_TYPE: {
    PRIVATE: "private",
  },
}));

vi.mock("../../../src/interaction/constants.js", () => ({
  INTERACTION_CLEAR_REASON: {
    SESSION_MISMATCH_RESET: "session_mismatch_reset",
  },
}));

vi.mock("../../../src/topic/manager.js", () => ({
  getTopicBindingByScopeKey: mocked.getTopicBindingByScopeKeyMock,
}));

vi.mock("../../../src/scheduled-task/store.js", () => ({
  getScheduledTaskTopicByChatAndThread: mocked.getScheduledTaskTopicByChatAndThreadMock,
}));

vi.mock("../../../src/bot/assistant-run-state.js", () => ({
  assistantRunState: {
    startRun: mocked.assistantRunStateStartRunMock,
    clearRun: mocked.assistantRunStateClearRunMock,
  },
}));

function createContext(): Context {
  return {
    chat: {
      id: -100123,
      type: "supergroup",
    },
    message: {
      text: "Test",
      message_thread_id: 555,
    },
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

describe("bot/handlers/prompt", () => {
  beforeEach(() => {
    __resetQueuedPromptsForTests();
    mocked.getCurrentProjectMock.mockReset();
    mocked.isTtsEnabledMock.mockReset();
    mocked.getScheduledTaskTopicByChatAndThreadMock.mockReset();
    mocked.getCurrentSessionMock.mockReset();
    mocked.getStoredAgentMock.mockReset();
    mocked.getStoredModelMock.mockReset();
    mocked.getTopicBindingByScopeKeyMock.mockReset();
    mocked.safeBackgroundTaskMock.mockReset();
    mocked.sessionStatusMock.mockReset();
    mocked.sessionPromptAsyncMock.mockReset();
    mocked.assistantRunStateStartRunMock.mockReset();
    mocked.assistantRunStateClearRunMock.mockReset();

    mocked.getCurrentProjectMock.mockReturnValue({ id: "project-1", worktree: "/repo/app" });
    mocked.isTtsEnabledMock.mockReturnValue(false);
    mocked.getCurrentSessionMock.mockReturnValue({
      id: "session-1",
      title: "Session",
      directory: "/repo/app",
    });
    mocked.getStoredAgentMock.mockReturnValue("builder");
    mocked.getStoredModelMock.mockReturnValue({
      providerID: "openai",
      modelID: "gpt-5",
      variant: "fast",
    });
    mocked.getTopicBindingByScopeKeyMock.mockReturnValue({ sessionId: "session-1" });
    mocked.sessionStatusMock.mockResolvedValue({
      data: { "session-1": { type: "idle" } },
      error: null,
    });
    mocked.sessionPromptAsyncMock.mockResolvedValue({ error: null });
    mocked.safeBackgroundTaskMock.mockImplementation(
      async ({
        task,
        onSuccess,
        onError,
      }: {
        task: () => Promise<unknown>;
        onSuccess?: (value: unknown) => void | Promise<void>;
        onError?: (error: unknown) => void | Promise<void>;
      }) => {
        try {
          const value = await task();
          if (onSuccess) {
            await onSuccess(value);
          }
        } catch (error) {
          if (onError) {
            await onError(error);
          }
        }
      },
    );
  });

  it("blocks prompt text in scheduled task output topics with better guidance", async () => {
    mocked.getScheduledTaskTopicByChatAndThreadMock.mockResolvedValue({
      chatId: -100123,
      projectId: "project-1",
      projectWorktree: "/repo/app",
      threadId: 555,
      topicName: "⏰ Scheduled Task Output",
      createdAt: "2026-03-26T00:00:00.000Z",
      updatedAt: "2026-03-26T00:00:00.000Z",
    });

    const ctx = createContext();
    const result = await processUserPrompt(ctx, "Test", {
      bot: {} as Bot<Context>,
      ensureEventSubscription: vi.fn(),
    });

    expect(result).toBe(false);
    expect(ctx.reply).toHaveBeenCalledWith(t("task.output_topic_blocked"), {
      message_thread_id: 555,
    });
    expect(mocked.getCurrentProjectMock).not.toHaveBeenCalled();
  });

  it("queues prompts while the current session is busy and dispatches them on idle", async () => {
    mocked.getScheduledTaskTopicByChatAndThreadMock.mockResolvedValue(null);
    mocked.sessionStatusMock.mockResolvedValueOnce({
      data: { "session-1": { type: "busy" } },
      error: null,
    });

    const ctx = createContext();
    const bot = {
      api: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as Bot<Context>;

    const result = await processUserPrompt(
      ctx,
      "Test",
      {
        bot,
        ensureEventSubscription: vi.fn(),
      },
      [],
      { responseMode: "text_and_tts" },
    );

    expect(result).toBe(true);
    expect(ctx.reply).toHaveBeenCalledWith(t("bot.session_queued", { position: "1" }));
    expect(mocked.sessionPromptAsyncMock).not.toHaveBeenCalled();

    mocked.sessionStatusMock.mockResolvedValueOnce({
      data: { "session-1": { type: "idle" } },
      error: null,
    });

    const dispatched = await dispatchNextQueuedPrompt("session-1");

    expect(dispatched).toBe(true);
    expect(bot.api.sendMessage).toHaveBeenCalledWith(
      -100123,
      t("bot.session_queue_started", { preview: "Test" }),
      { message_thread_id: 555 },
    );
    expect(mocked.sessionPromptAsyncMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      directory: "/repo/app",
      parts: [{ type: "text", text: "Test" }],
      agent: "builder",
      model: { providerID: "openai", modelID: "gpt-5" },
      variant: "fast",
    });
    expect(mocked.assistantRunStateStartRunMock).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        configuredAgent: "builder",
        configuredProviderID: "openai",
        configuredModelID: "gpt-5",
      }),
    );
    expect(consumePromptResponseMode("session-1")).toBe("text_and_tts");
  });

  it("uses TTS response mode by default when the scope setting is enabled", async () => {
    mocked.getScheduledTaskTopicByChatAndThreadMock.mockResolvedValue(null);
    mocked.isTtsEnabledMock.mockReturnValue(true);

    const ctx = createContext();

    await processUserPrompt(ctx, "Test", {
      bot: {} as Bot<Context>,
      ensureEventSubscription: vi.fn(),
    });

    expect(consumePromptResponseMode("session-1")).toBe("text_and_tts");
    expect(mocked.isTtsEnabledMock).toHaveBeenCalledWith();
  });
});
