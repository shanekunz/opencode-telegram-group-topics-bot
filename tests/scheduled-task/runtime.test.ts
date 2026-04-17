import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetSettingsForTests,
  getScheduledTasks,
  setScheduledTasks,
} from "../../src/settings/manager.js";
import {
  createScheduledTaskRuntime,
  __getNextCronRunAtForTests,
} from "../../src/scheduled-task/runtime.js";

const mocked = vi.hoisted(() => ({
  executeScheduledTaskMock: vi.fn(),
  sendBotTextMock: vi.fn(),
}));

vi.mock("../../src/scheduled-task/executor.js", () => ({
  executeScheduledTask: mocked.executeScheduledTaskMock,
}));

vi.mock("../../src/bot/utils/telegram-text.js", () => ({
  sendBotText: mocked.sendBotTextMock,
}));

describe("scheduled-task/runtime", () => {
  beforeEach(() => {
    __resetSettingsForTests();
    mocked.executeScheduledTaskMock.mockReset();
    mocked.sendBotTextMock.mockReset();
  });

  it("computes the next cron run in the configured timezone", () => {
    expect(__getNextCronRunAtForTests("0 9 * * 1-5", "UTC", "2026-03-25T08:30:00.000Z")).toBe(
      "2026-03-25T09:00:00.000Z",
    );
  });

  it("executes due one-time tasks and removes them after delivery", async () => {
    await setScheduledTasks([
      {
        id: "task-1",
        kind: "once",
        projectId: "project-1",
        projectWorktree: "/repo/app",
        createdFromScopeKey: "-100123:77",
        agent: "review",
        model: { providerID: "openai", modelID: "gpt-5", variant: null },
        delivery: { chatId: -100123, threadId: 555 },
        scheduleText: "once",
        scheduleSummary: "once",
        timezone: "UTC",
        prompt: "Run the report",
        createdAt: "2026-03-25T00:00:00.000Z",
        nextRunAt: "2026-03-25T00:00:00.000Z",
        lastRunAt: null,
        runCount: 0,
        lastStatus: "idle",
        lastError: null,
        runAt: "2026-03-25T00:00:00.000Z",
      },
    ]);
    mocked.executeScheduledTaskMock.mockResolvedValue({
      taskId: "task-1",
      status: "success",
      startedAt: "2026-03-25T00:00:00.000Z",
      finishedAt: "2026-03-25T00:01:00.000Z",
      resultText: "Done",
      errorMessage: null,
    });

    const runtime = createScheduledTaskRuntime({ api: {} } as never);
    await runtime.runDueTasks();

    expect(mocked.executeScheduledTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-1" }),
    );
    expect(mocked.sendBotTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: -100123,
        text: expect.stringContaining("Scheduled task completed"),
        options: { message_thread_id: 555 },
      }),
    );
    expect(getScheduledTasks()).toEqual([]);
  });

  it("recovers stale running tasks and executes them on the next poll", async () => {
    await setScheduledTasks([
      {
        id: "task-stale",
        kind: "cron",
        projectId: "project-1",
        projectWorktree: "/repo/app",
        createdFromScopeKey: "-100123:77",
        agent: "review",
        model: { providerID: "openai", modelID: "gpt-5", variant: null },
        delivery: { chatId: -100123, threadId: null },
        scheduleText: "every hour",
        scheduleSummary: "Every hour",
        timezone: "UTC",
        prompt: "Resume the report",
        createdAt: "2026-03-25T00:00:00.000Z",
        nextRunAt: "2026-03-25T00:00:00.000Z",
        lastRunAt: null,
        runCount: 0,
        lastStatus: "running",
        lastError: null,
        cron: "0 * * * *",
      },
    ]);
    mocked.executeScheduledTaskMock.mockResolvedValue({
      taskId: "task-stale",
      status: "success",
      startedAt: "2026-03-25T00:00:00.000Z",
      finishedAt: "2026-03-25T00:01:00.000Z",
      resultText: "Recovered",
      errorMessage: null,
    });

    const runtime = createScheduledTaskRuntime({ api: {} } as never);
    await runtime.runDueTasks();

    expect(mocked.executeScheduledTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-stale" }),
    );
    expect(getScheduledTasks()[0]).toEqual(
      expect.objectContaining({
        id: "task-stale",
        lastStatus: "success",
        lastError: null,
        runCount: 1,
      }),
    );
  });

  it("marks the task error if delivery fails after execution", async () => {
    await setScheduledTasks([
      {
        id: "task-delivery-fail",
        kind: "cron",
        projectId: "project-1",
        projectWorktree: "/repo/app",
        createdFromScopeKey: "-100123:77",
        agent: "review",
        model: { providerID: "openai", modelID: "gpt-5", variant: null },
        delivery: { chatId: -100123, threadId: null },
        scheduleText: "every hour",
        scheduleSummary: "Every hour",
        timezone: "UTC",
        prompt: "Resume the report",
        createdAt: "2026-03-25T00:00:00.000Z",
        nextRunAt: "2026-03-25T00:00:00.000Z",
        lastRunAt: null,
        runCount: 0,
        lastStatus: "idle",
        lastError: null,
        cron: "0 * * * *",
      },
    ]);
    mocked.executeScheduledTaskMock.mockResolvedValue({
      taskId: "task-delivery-fail",
      status: "success",
      startedAt: "2026-03-25T00:00:00.000Z",
      finishedAt: "2026-03-25T00:01:00.000Z",
      resultText: "Done",
      errorMessage: null,
    });
    mocked.sendBotTextMock.mockRejectedValue(new Error("thread missing"));

    const runtime = createScheduledTaskRuntime({ api: {} } as never);
    await runtime.runDueTasks();

    expect(getScheduledTasks()[0]).toEqual(
      expect.objectContaining({
        id: "task-delivery-fail",
        lastStatus: "error",
        lastError: "thread missing",
        runCount: 1,
      }),
    );
  });

  it("delivers timeout guidance returned by the executor", async () => {
    await setScheduledTasks([
      {
        id: "task-timeout",
        kind: "cron",
        projectId: "project-1",
        projectWorktree: "/repo/app",
        createdFromScopeKey: "-100123:77",
        agent: "review",
        model: { providerID: "openai", modelID: "gpt-5", variant: null },
        delivery: { chatId: -100123, threadId: 555 },
        scheduleText: "every hour",
        scheduleSummary: "Every hour",
        timezone: "UTC",
        prompt: "Resume the report",
        createdAt: "2026-03-25T00:00:00.000Z",
        nextRunAt: "2026-03-25T00:00:00.000Z",
        lastRunAt: null,
        runCount: 0,
        lastStatus: "idle",
        lastError: null,
        cron: "0 * * * *",
      },
    ]);
    mocked.executeScheduledTaskMock.mockResolvedValue({
      taskId: "task-timeout",
      status: "error",
      startedAt: "2026-03-25T00:00:00.000Z",
      finishedAt: "2026-03-25T00:01:00.000Z",
      resultText: null,
      errorMessage:
        "Request timed out after 300000ms. Check OpenCode model timeout settings: https://opencode.ai/docs/config/#models",
    });

    const runtime = createScheduledTaskRuntime({ api: {} } as never);
    await runtime.runDueTasks();

    expect(mocked.sendBotTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: -100123,
        text: expect.stringContaining("https://opencode.ai/docs/config/#models"),
        options: { message_thread_id: 555 },
      }),
    );
  });
});
