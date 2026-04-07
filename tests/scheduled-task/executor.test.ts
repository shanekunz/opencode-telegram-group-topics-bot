import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  sessionCreateMock: vi.fn(),
  sessionPromptMock: vi.fn(),
  sessionDeleteMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      create: mocked.sessionCreateMock,
      prompt: mocked.sessionPromptMock,
      delete: mocked.sessionDeleteMock,
    },
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: mocked.loggerDebugMock,
    info: mocked.loggerInfoMock,
    warn: mocked.loggerWarnMock,
    error: mocked.loggerErrorMock,
  },
}));

import { executeScheduledTask } from "../../src/scheduled-task/executor.js";

describe("scheduled-task/executor", () => {
  beforeEach(() => {
    mocked.sessionCreateMock.mockReset();
    mocked.sessionPromptMock.mockReset();
    mocked.sessionDeleteMock.mockReset();
    mocked.loggerDebugMock.mockReset();
    mocked.loggerInfoMock.mockReset();
    mocked.loggerWarnMock.mockReset();
    mocked.loggerErrorMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("executes a scheduled task with sync prompt and disabled timeout", async () => {
    mocked.sessionCreateMock.mockResolvedValue({
      data: { id: "session-1", directory: "/repo/app" },
      error: null,
    });
    mocked.sessionPromptMock.mockResolvedValue({
      data: {
        parts: [{ type: "text", text: "Finished overnight run." }],
      },
      error: null,
    });
    mocked.sessionDeleteMock.mockResolvedValue({});

    const execution = await executeScheduledTask({
      id: "task-1",
      kind: "cron",
      projectId: "project-1",
      projectWorktree: "/repo/app",
      createdFromScopeKey: "chat:1",
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5.4", variant: "default" },
      delivery: { chatId: 1, threadId: null },
      scheduleText: "every 20 minutes",
      scheduleSummary: "Every 20 minutes",
      timezone: "UTC",
      prompt: "Run the job",
      createdAt: "2026-04-05T00:00:00.000Z",
      nextRunAt: "2026-04-05T00:20:00.000Z",
      lastRunAt: null,
      runCount: 0,
      lastStatus: "idle",
      lastError: null,
      cron: "*/20 * * * *",
    });

    expect(mocked.sessionCreateMock).toHaveBeenCalledWith({
      directory: "/repo/app",
      title: "Scheduled task run",
      permission: [
        { permission: "*", pattern: "*", action: "allow" },
        { permission: "question", pattern: "*", action: "deny" },
      ],
    });
    expect(mocked.sessionPromptMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      directory: "/repo/app",
      parts: [{ type: "text", text: "Run the job" }],
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5.4", options: { timeout: false } },
      variant: "default",
    });
    expect(mocked.sessionDeleteMock).toHaveBeenCalledWith({ sessionID: "session-1" });
    expect(execution.status).toBe("success");
    expect(execution.resultText).toBe("Finished overnight run.");
  });

  it("returns an error when prompt execution fails", async () => {
    mocked.sessionCreateMock.mockResolvedValue({
      data: { id: "session-2", directory: "/repo/app" },
      error: null,
    });
    mocked.sessionPromptMock.mockResolvedValue({
      data: undefined,
      error: new Error("fetch failed"),
    });
    mocked.sessionDeleteMock.mockResolvedValue({});

    const execution = await executeScheduledTask({
      id: "task-2",
      kind: "once",
      projectId: "project-1",
      projectWorktree: "/repo/app",
      createdFromScopeKey: "chat:1",
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5.4", variant: "default" },
      delivery: { chatId: 1, threadId: null },
      scheduleText: "once",
      scheduleSummary: "Once",
      timezone: "UTC",
      prompt: "Run once",
      createdAt: "2026-04-05T00:00:00.000Z",
      nextRunAt: "2026-04-05T00:20:00.000Z",
      lastRunAt: null,
      runCount: 0,
      lastStatus: "idle",
      lastError: null,
      runAt: "2026-04-05T00:20:00.000Z",
    });

    expect(execution.status).toBe("error");
    expect(execution.errorMessage).toBe("fetch failed");
  });

  it("returns an error when the assistant response is empty", async () => {
    mocked.sessionCreateMock.mockResolvedValue({
      data: { id: "session-3", directory: "/repo/app" },
      error: null,
    });
    mocked.sessionPromptMock.mockResolvedValue({
      data: {
        parts: [{ type: "text", text: "   " }],
      },
      error: null,
    });
    mocked.sessionDeleteMock.mockResolvedValue({});

    const execution = await executeScheduledTask({
      id: "task-3",
      kind: "once",
      projectId: "project-1",
      projectWorktree: "/repo/app",
      createdFromScopeKey: "chat:1",
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5.4", variant: "default" },
      delivery: { chatId: 1, threadId: null },
      scheduleText: "once",
      scheduleSummary: "Once",
      timezone: "UTC",
      prompt: "Run once",
      createdAt: "2026-04-05T00:00:00.000Z",
      nextRunAt: "2026-04-05T00:20:00.000Z",
      lastRunAt: null,
      runCount: 0,
      lastStatus: "idle",
      lastError: null,
      runAt: "2026-04-05T00:20:00.000Z",
    });

    expect(execution.status).toBe("error");
    expect(execution.errorMessage).toBe("Scheduled task returned an empty assistant response");
  });
});
