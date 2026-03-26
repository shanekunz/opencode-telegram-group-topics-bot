import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { handleTaskTextAnswer, taskCommand } from "../../../src/bot/commands/task.js";
import { taskCreationManager } from "../../../src/scheduled-task/creation-manager.js";
import { interactionManager } from "../../../src/interaction/manager.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  getCurrentProjectMock: vi.fn(),
  getStoredModelMock: vi.fn(),
  getStoredAgentMock: vi.fn(),
  parseTaskScheduleMock: vi.fn(),
  addScheduledTaskMock: vi.fn(),
  getScheduledTaskTopicByChatAndProjectMock: vi.fn(),
  upsertScheduledTaskTopicMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getCurrentProject: mocked.getCurrentProjectMock,
}));

vi.mock("../../../src/model/manager.js", () => ({
  getStoredModel: mocked.getStoredModelMock,
}));

vi.mock("../../../src/agent/manager.js", () => ({
  getStoredAgent: mocked.getStoredAgentMock,
}));

vi.mock("../../../src/scheduled-task/schedule-parser.js", () => ({
  parseTaskSchedule: mocked.parseTaskScheduleMock,
}));

vi.mock("../../../src/scheduled-task/store.js", () => ({
  addScheduledTask: mocked.addScheduledTaskMock,
  getScheduledTaskTopicByChatAndProject: mocked.getScheduledTaskTopicByChatAndProjectMock,
  upsertScheduledTaskTopic: mocked.upsertScheduledTaskTopicMock,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    info: mocked.loggerInfoMock,
    warn: mocked.loggerWarnMock,
    error: mocked.loggerErrorMock,
    debug: vi.fn(),
  },
}));

function createContext(text: string, threadId: number): Context {
  return {
    chat: {
      id: -100123,
      type: "supergroup",
      is_forum: true,
    },
    message: {
      text,
      message_thread_id: threadId,
      is_topic_message: true,
    },
    reply: vi.fn().mockResolvedValue({ message_id: 1000 + threadId }),
    api: {
      createForumTopic: vi.fn().mockResolvedValue({ message_thread_id: 555 }),
      editForumTopic: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Context;
}

describe("bot/commands/task", () => {
  beforeEach(() => {
    taskCreationManager.clearAll();
    interactionManager.clear("test_setup", "-100123:77");
    mocked.getCurrentProjectMock.mockReset();
    mocked.getStoredModelMock.mockReset();
    mocked.getStoredAgentMock.mockReset();
    mocked.parseTaskScheduleMock.mockReset();
    mocked.addScheduledTaskMock.mockReset();
    mocked.getScheduledTaskTopicByChatAndProjectMock.mockReset();
    mocked.upsertScheduledTaskTopicMock.mockReset();
    mocked.loggerInfoMock.mockReset();
    mocked.loggerWarnMock.mockReset();
    mocked.loggerErrorMock.mockReset();

    mocked.getCurrentProjectMock.mockReturnValue({
      id: "project-1",
      worktree: "/repo/app",
      name: "App",
    });
    mocked.getStoredModelMock.mockReturnValue({
      providerID: "openai",
      modelID: "gpt-5",
      variant: "fast",
    });
    mocked.getStoredAgentMock.mockReturnValue("review");
  });

  it("creates the first forum scheduled task in a dedicated scheduled topic", async () => {
    mocked.parseTaskScheduleMock.mockResolvedValue({
      kind: "cron",
      cron: "0 9 * * 1-5",
      timezone: "UTC",
      summary: "weekdays 09:00",
      nextRunAt: "2026-03-26T09:00:00.000Z",
    });
    mocked.getScheduledTaskTopicByChatAndProjectMock.mockResolvedValue(null);

    const commandCtx = createContext("/task", 77);
    await taskCommand(commandCtx as never);

    const scheduleCtx = createContext("every weekday at 09:00", 77);
    await handleTaskTextAnswer(scheduleCtx);

    const promptCtx = createContext("Check open PRs and summarize blockers", 77);
    await handleTaskTextAnswer(promptCtx);

    expect((promptCtx.api.createForumTopic as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([
      -100123,
      "⏰ Scheduled Task Output",
      { icon_color: 7322096 },
    ]);
    expect(mocked.upsertScheduledTaskTopicMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: -100123,
        projectId: "project-1",
        threadId: 555,
      }),
    );
    expect(mocked.addScheduledTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "cron",
        projectId: "project-1",
        createdFromScopeKey: "-100123:77",
        agent: "review",
        delivery: { chatId: -100123, threadId: 555 },
        model: { providerID: "openai", modelID: "gpt-5", variant: "fast" },
      }),
    );
  });

  it("reuses an existing scheduled topic for the same chat and project", async () => {
    mocked.parseTaskScheduleMock.mockResolvedValue({
      kind: "once",
      runAt: "2026-03-26T18:30:00.000Z",
      timezone: "UTC",
      summary: "26 Mar 18:30",
      nextRunAt: "2026-03-26T18:30:00.000Z",
    });
    mocked.getScheduledTaskTopicByChatAndProjectMock.mockResolvedValue({
      chatId: -100123,
      projectId: "project-1",
      projectWorktree: "/repo/app",
      threadId: 333,
      topicName: "⏰ Scheduled Task Output",
      createdAt: "2026-03-25T00:00:00.000Z",
      updatedAt: "2026-03-25T00:00:00.000Z",
    });

    await taskCommand(createContext("/task", 77) as never);
    await handleTaskTextAnswer(createContext("tomorrow at 18:30", 77));

    const promptCtx = createContext("Run the nightly review", 77);
    await handleTaskTextAnswer(promptCtx);

    expect(promptCtx.api.createForumTopic).not.toHaveBeenCalled();
    expect(mocked.upsertScheduledTaskTopicMock).not.toHaveBeenCalled();
    expect(mocked.addScheduledTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "once",
        delivery: { chatId: -100123, threadId: 333 },
      }),
    );
  });

  it("renames legacy scheduled topics when reusing them", async () => {
    mocked.parseTaskScheduleMock.mockResolvedValue({
      kind: "once",
      runAt: "2026-03-26T18:30:00.000Z",
      timezone: "UTC",
      summary: "26 Mar 18:30",
      nextRunAt: "2026-03-26T18:30:00.000Z",
    });
    mocked.getScheduledTaskTopicByChatAndProjectMock.mockResolvedValue({
      chatId: -100123,
      projectId: "project-1",
      projectWorktree: "/repo/app",
      threadId: 333,
      topicName: "Scheduled - /repo/app",
      createdAt: "2026-03-25T00:00:00.000Z",
      updatedAt: "2026-03-25T00:00:00.000Z",
    });

    await taskCommand(createContext("/task", 77) as never);
    await handleTaskTextAnswer(createContext("tomorrow at 18:30", 77));

    const promptCtx = createContext("Run the nightly review", 77);
    await handleTaskTextAnswer(promptCtx);

    expect(promptCtx.api.editForumTopic).toHaveBeenCalledWith(-100123, 333, {
      name: "⏰ Scheduled Task Output",
    });
    expect(mocked.upsertScheduledTaskTopicMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: -100123,
        projectId: "project-1",
        threadId: 333,
        topicName: "⏰ Scheduled Task Output",
      }),
    );
  });

  it("sends a concise schedule preview before the separate prompt request", async () => {
    mocked.parseTaskScheduleMock.mockResolvedValue({
      kind: "once",
      runAt: "2026-03-26T18:30:00.000Z",
      timezone: "UTC",
      summary: "in one minute",
      nextRunAt: "2026-03-26T18:30:00.000Z",
    });
    mocked.getScheduledTaskTopicByChatAndProjectMock.mockResolvedValue({
      chatId: -100123,
      projectId: "project-1",
      projectWorktree: "/repo/app",
      threadId: 333,
      topicName: "⏰ Scheduled Task Output",
      createdAt: "2026-03-25T00:00:00.000Z",
      updatedAt: "2026-03-25T00:00:00.000Z",
    });

    const commandCtx = createContext("/task", 77);
    await taskCommand(commandCtx as never);

    const scheduleCtx = createContext("in one minute", 77);
    await handleTaskTextAnswer(scheduleCtx);

    const replyMock = scheduleCtx.reply as ReturnType<typeof vi.fn>;
    expect(replyMock).toHaveBeenCalledTimes(2);
    expect((commandCtx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain(
      "🎛️ Session Control",
    );
    expect(replyMock).toHaveBeenNthCalledWith(
      1,
      t("task.schedule_preview", {
        summary: "in one minute",
        nextRunAt: "2026-03-26T18:30:00.000Z",
      }),
    );
    expect(replyMock).toHaveBeenNthCalledWith(2, t("task.prompt_prompt"));
    expect(t("task.prompt_prompt")).toContain("🎛️ Session Control");
  });
});
