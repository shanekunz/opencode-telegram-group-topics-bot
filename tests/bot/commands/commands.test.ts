import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import {
  commandsCommand,
  handleCommandTextArguments,
  handleCommandsCallback,
  type ExecuteCommandDeps,
} from "../../../src/bot/commands/commands.js";
import { interactionManager } from "../../../src/interaction/manager.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  currentProject: {
    id: "project-1",
    worktree: "D:\\Projects\\Repo",
  } as { id: string; worktree: string } | null,
  currentSession: {
    id: "session-1",
    title: "Session",
    directory: "D:\\Projects\\Repo",
  } as { id: string; title: string; directory: string } | null,
  commandListMock: vi.fn(),
  sessionStatusMock: vi.fn(),
  sessionCreateMock: vi.fn(),
  sessionCommandMock: vi.fn(),
  setCurrentSessionMock: vi.fn(),
  clearSessionMock: vi.fn(),
  ingestSessionInfoForCacheMock: vi.fn(),
  setSessionSummaryMock: vi.fn(),
  setBotAndChatIdMock: vi.fn(),
  clearSummaryMock: vi.fn(),
  ensureEventSubscriptionMock: vi.fn(),
  safeBackgroundTaskMock: vi.fn(),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getCurrentProject: vi.fn(() => mocked.currentProject),
}));

vi.mock("../../../src/session/manager.js", () => ({
  getCurrentSession: vi.fn(() => mocked.currentSession),
  setCurrentSession: vi.fn((session) => {
    mocked.currentSession = session;
    mocked.setCurrentSessionMock(session);
  }),
  clearSession: vi.fn(() => {
    mocked.currentSession = null;
    mocked.clearSessionMock();
  }),
}));

vi.mock("../../../src/session/cache-manager.js", () => ({
  ingestSessionInfoForCache: mocked.ingestSessionInfoForCacheMock,
  __resetSessionDirectoryCacheForTests: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    command: {
      list: mocked.commandListMock,
    },
    session: {
      status: mocked.sessionStatusMock,
      create: mocked.sessionCreateMock,
      command: mocked.sessionCommandMock,
    },
  },
}));

vi.mock("../../../src/config.js", () => ({
  config: {
    server: {
      logLevel: "info",
    },
    bot: {
      commandsListLimit: 2,
    },
  },
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../../src/summary/aggregator.js", () => ({
  summaryAggregator: {
    setSession: mocked.setSessionSummaryMock,
    setBotAndChatId: mocked.setBotAndChatIdMock,
    clear: mocked.clearSummaryMock,
  },
}));

vi.mock("../../../src/agent/manager.js", () => ({
  getStoredAgent: vi.fn(() => "build"),
  resolveProjectAgent: vi.fn(async (agent: string) => agent),
}));

vi.mock("../../../src/model/manager.js", () => ({
  getStoredModel: vi.fn(() => ({
    providerID: "openai",
    modelID: "gpt-5",
    variant: "default",
  })),
}));

vi.mock("../../../src/utils/safe-background-task.js", () => ({
  safeBackgroundTask: vi.fn((options) => {
    mocked.safeBackgroundTaskMock(options);
    try {
      const taskPromise = options.task();
      void Promise.resolve(taskPromise)
        .then((result) => {
          if (options.onSuccess) {
            return options.onSuccess(result);
          }
        })
        .catch((error) => {
          if (options.onError) {
            return options.onError(error);
          }
        });
    } catch (error) {
      if (options.onError) {
        void options.onError(error);
      }
    }
  }),
}));

function createCommandContext(messageId: number): Context {
  return {
    chat: { id: 777 },
    reply: vi.fn().mockResolvedValue({ message_id: messageId }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 900 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Context;
}

function createCallbackContext(data: string, messageId: number): Context {
  return {
    chat: { id: 777 },
    callbackQuery: {
      data,
      message: {
        message_id: messageId,
      },
    } as Context["callbackQuery"],
    reply: vi.fn().mockResolvedValue({ message_id: 901 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 902 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Context;
}

function createTextContext(text: string): Context {
  return {
    chat: { id: 777 },
    message: { text } as Context["message"],
    reply: vi.fn().mockResolvedValue({ message_id: 903 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 904 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Context;
}

function createDeps(): ExecuteCommandDeps {
  return {
    ensureEventSubscription: mocked.ensureEventSubscriptionMock,
  };
}

describe("bot/commands/commands", () => {
  beforeEach(() => {
    interactionManager.clear("test_setup");

    mocked.currentProject = {
      id: "project-1",
      worktree: "D:\\Projects\\Repo",
    };
    mocked.currentSession = {
      id: "session-1",
      title: "Session",
      directory: "D:\\Projects\\Repo",
    };

    mocked.commandListMock.mockReset();
    mocked.sessionStatusMock.mockReset();
    mocked.sessionCreateMock.mockReset();
    mocked.sessionCommandMock.mockReset();
    mocked.setCurrentSessionMock.mockReset();
    mocked.clearSessionMock.mockReset();
    mocked.ingestSessionInfoForCacheMock.mockReset();
    mocked.setSessionSummaryMock.mockReset();
    mocked.setBotAndChatIdMock.mockReset();
    mocked.clearSummaryMock.mockReset();
    mocked.ensureEventSubscriptionMock.mockReset();
    mocked.safeBackgroundTaskMock.mockReset();

    mocked.sessionStatusMock.mockResolvedValue({
      data: {
        "session-1": {
          type: "idle",
        },
      },
      error: null,
    });
    mocked.sessionCommandMock.mockResolvedValue({ data: {}, error: null });
  });

  it("shows commands list and starts custom interaction", async () => {
    mocked.commandListMock.mockResolvedValue({
      data: [
        { name: "init", description: "create/update AGENTS.md" },
        { name: "poem", description: "write a poem" },
      ],
      error: null,
    });

    const ctx = createCommandContext(123);
    await commandsCommand(ctx as never);

    expect(mocked.commandListMock).toHaveBeenCalledWith({ directory: "D:/Projects/Repo" });
    expect(ctx.reply).toHaveBeenCalledTimes(1);

    const [, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string }>> } },
    ];
    expect(options.reply_markup.inline_keyboard[0]?.[0]?.callback_data).toBe("commands:select:0");
    expect(options.reply_markup.inline_keyboard[1]?.[0]?.callback_data).toBe("commands:select:1");
    expect(options.reply_markup.inline_keyboard[2]?.[0]?.callback_data).toBe("commands:cancel");

    const state = interactionManager.getSnapshot();
    expect(state?.kind).toBe("custom");
    expect(state?.expectedInput).toBe("callback");
    expect(state?.metadata.flow).toBe("commands");
    expect(state?.metadata.stage).toBe("list");
    expect(state?.metadata.messageId).toBe(123);
    expect(state?.metadata.page).toBe(0);
  });

  it("filters non-command entries and paginates command list", async () => {
    mocked.commandListMock.mockResolvedValue({
      data: [
        { name: "init", description: "create/update AGENTS.md" },
        { name: "skill-helper", description: "hidden", source: "skill" },
        { name: "deploy", description: "ship it" },
        { name: "mcp-helper", description: "hidden", source: "mcp", type: "prompt" },
        { name: "review", description: "review changes" },
      ],
      error: null,
    });

    const ctx = createCommandContext(124);
    await commandsCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(
      t("commands.select_page", { current: 1, total: 2 }),
      expect.objectContaining({ reply_markup: expect.any(Object) }),
    );

    const [, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      {
        reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string; text?: string }>> };
      },
    ];
    expect(options.reply_markup.inline_keyboard[0]?.[0]?.callback_data).toBe("commands:select:0");
    expect(options.reply_markup.inline_keyboard[1]?.[0]?.callback_data).toBe("commands:select:1");
    expect(options.reply_markup.inline_keyboard[2]?.[0]?.callback_data).toBe("commands:page:1");
    expect(options.reply_markup.inline_keyboard[3]?.[0]?.callback_data).toBe("commands:cancel");

    const state = interactionManager.getSnapshot();
    expect(state?.metadata.commands).toEqual([
      { name: "init", description: "create/update AGENTS.md" },
      { name: "deploy", description: "ship it" },
      { name: "review", description: "review changes" },
    ]);
  });

  it("switches command pages via callback", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "commands",
        stage: "list",
        messageId: 322,
        projectDirectory: "D:\\Projects\\Repo",
        commands: [
          { name: "init", description: "create/update AGENTS.md" },
          { name: "deploy", description: "ship it" },
          { name: "review", description: "review changes" },
        ],
        page: 0,
      },
    });

    const callbackCtx = createCallbackContext("commands:page:1", 322);
    const handled = await handleCommandsCallback(callbackCtx, createDeps());

    expect(handled).toBe(true);
    expect(callbackCtx.editMessageText).toHaveBeenCalledWith(
      t("commands.select_page", { current: 2, total: 2 }),
      expect.objectContaining({ reply_markup: expect.any(Object) }),
    );
    expect(callbackCtx.answerCallbackQuery).toHaveBeenCalledWith();
    expect(interactionManager.getSnapshot()?.metadata.page).toBe(1);
  });

  it("transitions to confirmation step after selecting command", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "commands",
        stage: "list",
        messageId: 321,
        projectDirectory: "D:\\Projects\\Repo",
        commands: [
          { name: "init", description: "create/update AGENTS.md" },
          { name: "poem", description: "write a poem" },
        ],
        page: 0,
      },
    });

    const callbackCtx = createCallbackContext("commands:select:1", 321);
    const handled = await handleCommandsCallback(callbackCtx, createDeps());

    expect(handled).toBe(true);

    expect(callbackCtx.editMessageText).toHaveBeenCalledWith(
      t("commands.confirm", { command: "/poem" }),
      expect.objectContaining({ reply_markup: expect.any(Object) }),
    );

    const state = interactionManager.getSnapshot();
    expect(state?.kind).toBe("custom");
    expect(state?.expectedInput).toBe("mixed");
    expect(state?.metadata.stage).toBe("confirm");
    expect(state?.metadata.commandName).toBe("poem");
  });

  it("executes selected command from callback", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "mixed",
      metadata: {
        flow: "commands",
        stage: "confirm",
        messageId: 400,
        projectDirectory: "D:\\Projects\\Repo",
        commandName: "poem",
      },
    });

    const ctx = createCallbackContext("commands:execute", 400);
    const handled = await handleCommandsCallback(ctx, createDeps());
    await Promise.resolve();

    expect(handled).toBe(true);
    expect(interactionManager.getSnapshot()).toBeNull();
    expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);
    expect(ctx.reply).toHaveBeenCalledWith(t("commands.executing", { command: "/poem" }), {});
    expect(mocked.ensureEventSubscriptionMock).toHaveBeenCalledWith("D:\\Projects\\Repo");
    expect(mocked.setSessionSummaryMock).toHaveBeenCalledWith("session-1");
    expect(mocked.sessionCommandMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      directory: "D:\\Projects\\Repo",
      command: "poem",
      arguments: "",
      agent: "build",
      model: "openai/gpt-5",
      variant: "default",
    });
  });

  it("executes selected command with arguments from text message", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "mixed",
      metadata: {
        flow: "commands",
        stage: "confirm",
        messageId: 500,
        projectDirectory: "D:\\Projects\\Repo",
        commandName: "poem",
      },
    });

    const ctx = createTextContext("about spring");
    const handled = await handleCommandTextArguments(ctx, createDeps());
    await Promise.resolve();

    expect(handled).toBe(true);
    expect(interactionManager.getSnapshot()).toBeNull();
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(777, 500);
    expect(ctx.reply).toHaveBeenCalledWith(
      t("commands.executing", { command: "/poem about spring" }),
      {},
    );
    expect(mocked.sessionCommandMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      directory: "D:\\Projects\\Repo",
      command: "poem",
      arguments: "about spring",
      agent: "build",
      model: "openai/gpt-5",
      variant: "default",
    });
  });

  it("handles stale callback as inactive", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "commands",
        stage: "list",
        messageId: 600,
        projectDirectory: "D:\\Projects\\Repo",
        commands: [{ name: "init", description: "create/update AGENTS.md" }],
        page: 0,
      },
    });

    const ctx = createCallbackContext("commands:cancel", 999);
    const handled = await handleCommandsCallback(ctx, createDeps());

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("commands.inactive_callback"),
      show_alert: true,
    });
    expect(interactionManager.getSnapshot()?.kind).toBe("custom");
  });
});
