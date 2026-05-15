import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  const bot = {
    api: {
      getWebhookInfo: vi.fn(),
      deleteWebhook: vi.fn(),
    },
    start: vi.fn(),
    stop: vi.fn(),
  };

  const scheduledTaskRuntime = {
    start: vi.fn(),
    stop: vi.fn(),
  };

  return {
    cleanupBotRuntimeMock: vi.fn(),
    createBotMock: vi.fn(() => bot),
    bot,
    config: {
      telegram: { allowedUserId: 123456789 },
      opencode: {
        apiUrl: "http://localhost:4096",
        password: "",
      },
    },
    reconcileStoredModelSelectionMock: vi.fn(),
    opencodeAutoRestartStartMock: vi.fn(),
    opencodeAutoRestartStopMock: vi.fn(),
    loadSettingsMock: vi.fn(),
    warmupSessionDirectoryCacheMock: vi.fn(),
    createScheduledTaskRuntimeMock: vi.fn(() => scheduledTaskRuntime),
    scheduledTaskRuntime,
    getRuntimeModeMock: vi.fn(() => "bot"),
    getRuntimePathsMock: vi.fn(() => ({ envFilePath: "/tmp/test.env" })),
    clearServiceStateFileMock: vi.fn(),
    getServiceStateFilePathFromEnvMock: vi.fn(() => null),
    isServiceChildProcessMock: vi.fn(() => false),
    loggerInfoMock: vi.fn(),
    loggerDebugMock: vi.fn(),
    loggerWarnMock: vi.fn(),
    safeBackgroundTaskMock: vi.fn(),
  };
});

vi.mock("../../src/bot/index.js", () => ({
  cleanupBotRuntime: mocked.cleanupBotRuntimeMock,
  createBot: mocked.createBotMock,
}));

vi.mock("../../src/config.js", () => ({
  config: mocked.config,
}));

vi.mock("../../src/model/manager.js", () => ({
  reconcileStoredModelSelection: mocked.reconcileStoredModelSelectionMock,
}));

vi.mock("../../src/opencode/auto-restart.js", () => ({
  opencodeAutoRestartService: {
    start: mocked.opencodeAutoRestartStartMock,
    stop: mocked.opencodeAutoRestartStopMock,
  },
}));

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: {
    global: {
      health: vi.fn(),
    },
  },
}));

vi.mock("../../src/settings/manager.js", () => ({
  loadSettings: mocked.loadSettingsMock,
}));

vi.mock("../../src/session/cache-manager.js", () => ({
  warmupSessionDirectoryCache: mocked.warmupSessionDirectoryCacheMock,
  __resetSessionDirectoryCacheForTests: vi.fn(),
}));

vi.mock("../../src/scheduled-task/runtime.js", () => ({
  createScheduledTaskRuntime: mocked.createScheduledTaskRuntimeMock,
}));

vi.mock("../../src/runtime/mode.js", () => ({
  getRuntimeMode: mocked.getRuntimeModeMock,
}));

vi.mock("../../src/runtime/paths.js", () => ({
  getRuntimePaths: mocked.getRuntimePathsMock,
}));

vi.mock("../../src/service/manager.js", () => ({
  clearServiceStateFile: mocked.clearServiceStateFileMock,
}));

vi.mock("../../src/service/runtime.js", () => ({
  getServiceStateFilePathFromEnv: mocked.getServiceStateFilePathFromEnvMock,
  isServiceChildProcess: mocked.isServiceChildProcessMock,
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: mocked.loggerInfoMock,
    debug: mocked.loggerDebugMock,
    warn: mocked.loggerWarnMock,
  },
}));

vi.mock("../../src/utils/safe-background-task.js", () => ({
  safeBackgroundTask: mocked.safeBackgroundTaskMock,
}));

describe("app/start-bot-app", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocked.loadSettingsMock.mockResolvedValue(undefined);
    mocked.reconcileStoredModelSelectionMock.mockResolvedValue(undefined);
    mocked.warmupSessionDirectoryCacheMock.mockResolvedValue(undefined);
    mocked.opencodeAutoRestartStartMock.mockReset();
    mocked.opencodeAutoRestartStopMock.mockReset();
    mocked.safeBackgroundTaskMock.mockImplementation(({ task }: { task: () => Promise<void> }) => {
      void task();
    });
    mocked.bot.api.getWebhookInfo.mockResolvedValue({ url: "" });
    mocked.bot.api.deleteWebhook.mockResolvedValue(true);
    mocked.bot.start.mockImplementation(async () => undefined);
    mocked.bot.stop.mockImplementation(() => undefined);
  });

  it("queues OpenCode startup checks in the background before polling starts", async () => {
    const startupGate = new Promise<void>(() => {
      // Keep the startup task pending to prove bot.start does not await it.
    });
    mocked.opencodeAutoRestartStartMock.mockReturnValue(startupGate);

    const { startBotApp } = await import("../../src/app/start-bot-app.js");

    await startBotApp();

    expect(mocked.safeBackgroundTaskMock).toHaveBeenCalledWith({
      taskName: "app.opencodeStartup",
      task: expect.any(Function),
    });
    expect(mocked.opencodeAutoRestartStartMock).toHaveBeenCalledTimes(1);
    expect(mocked.bot.start).toHaveBeenCalledTimes(1);
  });
});
