import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  sessionStatusMock: vi.fn(),
  dispatchNextQueuedPromptMock: vi.fn(),
  clearPromptResponseModeMock: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      status: mocked.sessionStatusMock,
    },
  },
}));

vi.mock("../../../src/bot/handlers/prompt.js", () => ({
  dispatchNextQueuedPrompt: mocked.dispatchNextQueuedPromptMock,
  clearPromptResponseMode: mocked.clearPromptResponseModeMock,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { assistantRunState } from "../../../src/bot/assistant-run-state.js";
import {
  __resetBusyReconciliationForTests,
  reconcileBusyState,
  reconcileBusyStateNow,
} from "../../../src/bot/utils/busy-reconciliation.js";

describe("bot/utils/busy-reconciliation", () => {
  beforeEach(() => {
    assistantRunState.__resetForTests();
    __resetBusyReconciliationForTests();
    mocked.sessionStatusMock.mockReset();
    mocked.dispatchNextQueuedPromptMock.mockReset().mockResolvedValue(false);
    mocked.clearPromptResponseModeMock.mockReset();
  });

  it("clears stale run state when the session is already idle", async () => {
    assistantRunState.startRun("session-1", {
      startedAt: Date.now(),
      directory: "/repo",
    });
    mocked.sessionStatusMock.mockResolvedValue({
      data: { "session-1": { type: "idle" } },
      error: null,
    });

    await reconcileBusyStateNow("/repo");

    expect(mocked.clearPromptResponseModeMock).toHaveBeenCalledWith("session-1");
    expect(mocked.dispatchNextQueuedPromptMock).toHaveBeenCalledWith("session-1");
    expect(assistantRunState.getRun("session-1")).toBeNull();
  });

  it("keeps active runs when the server still reports busy", async () => {
    assistantRunState.startRun("session-1", {
      startedAt: Date.now(),
      directory: "/repo",
    });
    mocked.sessionStatusMock.mockResolvedValue({
      data: { "session-1": { type: "busy" } },
      error: null,
    });

    await reconcileBusyStateNow("/repo");

    expect(mocked.clearPromptResponseModeMock).not.toHaveBeenCalled();
    expect(mocked.dispatchNextQueuedPromptMock).not.toHaveBeenCalled();
    expect(assistantRunState.getRun("session-1")).not.toBeNull();
  });

  it("throttles repeated reconciliation calls per directory", async () => {
    assistantRunState.startRun("session-1", {
      startedAt: Date.now(),
      directory: "/repo",
    });
    mocked.sessionStatusMock.mockResolvedValue({
      data: { "session-1": { type: "busy" } },
      error: null,
    });

    await reconcileBusyState("/repo");
    await reconcileBusyState("/repo");

    expect(mocked.sessionStatusMock).toHaveBeenCalledTimes(1);
  });
});
