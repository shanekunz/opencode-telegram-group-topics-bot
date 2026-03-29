import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { handleTaskListCallback, taskListCommand } from "../../../src/bot/commands/tasklist.js";
import { interactionManager } from "../../../src/interaction/manager.js";

const mocked = vi.hoisted(() => ({
  getCurrentProjectMock: vi.fn(),
  listScheduledTasksMock: vi.fn(),
  removeScheduledTaskMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getCurrentProject: mocked.getCurrentProjectMock,
}));

vi.mock("../../../src/scheduled-task/store.js", () => ({
  listScheduledTasks: mocked.listScheduledTasksMock,
  removeScheduledTask: mocked.removeScheduledTaskMock,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    error: mocked.loggerErrorMock,
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

function createCommandContext(): Context {
  return {
    chat: { id: -100123, type: "supergroup" },
    message: { text: "/tasklist", message_thread_id: 77, is_topic_message: true },
    reply: vi.fn().mockResolvedValue({ message_id: 456 }),
  } as unknown as Context;
}

function createCallbackContext(data: string): Context {
  return {
    chat: { id: -100123, type: "supergroup" },
    callbackQuery: {
      data,
      message: { message_id: 456, message_thread_id: 77 },
    } as Context["callbackQuery"],
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

describe("bot/commands/tasklist", () => {
  beforeEach(() => {
    interactionManager.clear("test_setup", "-100123:77");
    mocked.getCurrentProjectMock.mockReset();
    mocked.listScheduledTasksMock.mockReset();
    mocked.removeScheduledTaskMock.mockReset();
    mocked.loggerErrorMock.mockReset();

    mocked.getCurrentProjectMock.mockReturnValue({ id: "project-1", worktree: "/repo/app" });
  });

  it("lists only tasks for the current project in the current chat", async () => {
    mocked.listScheduledTasksMock.mockReturnValue([
      {
        id: "task-a",
        kind: "cron",
        projectId: "project-1",
        projectWorktree: "/repo/app",
        createdFromScopeKey: "-100123:77",
        agent: "review",
        model: { providerID: "openai", modelID: "gpt-5", variant: null },
        delivery: { chatId: -100123, threadId: 555 },
        scheduleText: "every weekday at 09:00",
        scheduleSummary: "weekdays 09:00",
        timezone: "UTC",
        prompt: "Review PRs",
        createdAt: "2026-03-25T00:00:00.000Z",
        nextRunAt: "2026-03-26T09:00:00.000Z",
        lastRunAt: null,
        runCount: 0,
        lastStatus: "idle",
        lastError: null,
        cron: "0 9 * * 1-5",
      },
      {
        id: "task-b",
        kind: "once",
        projectId: "project-1",
        projectWorktree: "/repo/app",
        createdFromScopeKey: "-100999:77",
        agent: "review",
        model: { providerID: "openai", modelID: "gpt-5", variant: null },
        delivery: { chatId: -100999, threadId: 777 },
        scheduleText: "tomorrow",
        scheduleSummary: "tomorrow",
        timezone: "UTC",
        prompt: "Other chat",
        createdAt: "2026-03-25T00:00:00.000Z",
        nextRunAt: "2026-03-26T09:00:00.000Z",
        lastRunAt: null,
        runCount: 0,
        lastStatus: "idle",
        lastError: null,
        runAt: "2026-03-26T09:00:00.000Z",
      },
    ]);

    const ctx = createCommandContext();
    await taskListCommand(ctx as never);

    const [text, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(text).toContain("weekdays 09:00");
    expect(text).not.toContain("Other chat");
    expect(options.reply_markup.inline_keyboard[0][0].callback_data).toBe("tasklist:delete:task-a");
  });

  it("removes tasks from the active task list menu", async () => {
    mocked.listScheduledTasksMock
      .mockReturnValueOnce([
        {
          id: "task-a",
          kind: "cron",
          projectId: "project-1",
          projectWorktree: "/repo/app",
          createdFromScopeKey: "-100123:77",
          agent: "review",
          model: { providerID: "openai", modelID: "gpt-5", variant: null },
          delivery: { chatId: -100123, threadId: 555 },
          scheduleText: "every weekday at 09:00",
          scheduleSummary: "weekdays 09:00",
          timezone: "UTC",
          prompt: "Review PRs",
          createdAt: "2026-03-25T00:00:00.000Z",
          nextRunAt: "2026-03-26T09:00:00.000Z",
          lastRunAt: null,
          runCount: 0,
          lastStatus: "idle",
          lastError: null,
          cron: "0 9 * * 1-5",
        },
      ])
      .mockReturnValueOnce([]);
    mocked.removeScheduledTaskMock.mockResolvedValue(true);

    await taskListCommand(createCommandContext() as never);

    const callbackCtx = createCallbackContext("tasklist:delete:task-a");
    const handled = await handleTaskListCallback(callbackCtx);

    expect(handled).toBe(true);
    expect(mocked.removeScheduledTaskMock).toHaveBeenCalledWith("task-a");
    expect(callbackCtx.answerCallbackQuery).toHaveBeenCalled();
    expect(callbackCtx.editMessageText).toHaveBeenCalledWith(
      "📭 No scheduled tasks for this project in this chat.",
    );
    expect(interactionManager.isActive("-100123:77")).toBe(false);
  });
});
