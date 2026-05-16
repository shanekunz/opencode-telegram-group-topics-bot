import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { assistantRunState } from "../../../src/bot/assistant-run-state.js";
import {
  __resetQueuedPromptsForTests,
  activatePromptResponseMode,
  consumePromptResponseMode,
} from "../../../src/bot/handlers/prompt.js";
import { abortCommand } from "../../../src/bot/commands/abort.js";
import { clearAllInteractionState } from "../../../src/interaction/cleanup.js";
import { questionManager } from "../../../src/question/manager.js";
import { permissionManager } from "../../../src/permission/manager.js";
import { renameManager } from "../../../src/rename/manager.js";
import { interactionManager } from "../../../src/interaction/manager.js";
import { taskCreationManager } from "../../../src/scheduled-task/creation-manager.js";
import type { Question } from "../../../src/question/types.js";
import type { PermissionRequest } from "../../../src/permission/types.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  currentSession: null as { id: string; title: string; directory: string } | null,
  abortMock: vi.fn(),
  statusMock: vi.fn(),
}));

vi.mock("../../../src/session/manager.js", () => ({
  getCurrentSession: vi.fn(() => mocked.currentSession),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      abort: mocked.abortMock,
      status: mocked.statusMock,
    },
  },
}));

const TEST_QUESTION: Question = {
  header: "Q1",
  question: "Pick one",
  options: [
    { label: "Yes", description: "accept" },
    { label: "No", description: "decline" },
  ],
};

const TEST_PERMISSION: PermissionRequest = {
  id: "perm-1",
  sessionID: "session-1",
  permission: "bash",
  patterns: ["npm test"],
  metadata: {},
  always: [],
};

function activateInteractionState(): void {
  questionManager.startQuestions([TEST_QUESTION], "req-stop");
  permissionManager.startPermission(TEST_PERMISSION, 101);
  renameManager.startWaiting("session-1", "D:/repo", "Old title");
  interactionManager.start({
    kind: "rename",
    expectedInput: "text",
    metadata: { sessionId: "session-1" },
  });
}

describe("bot/commands/abort", () => {
  beforeEach(() => {
    clearAllInteractionState("test_setup");
    assistantRunState.__resetForTests();
    __resetQueuedPromptsForTests();
    taskCreationManager.clearAll();
    mocked.currentSession = null;
    mocked.abortMock.mockReset();
    mocked.statusMock.mockReset();
  });

  it("clears interaction state even when there is no active session", async () => {
    activateInteractionState();

    const replyMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      reply: replyMock,
    } as unknown as Context;

    await abortCommand(ctx as never);

    expect(replyMock).toHaveBeenCalledWith(t("stop.cancelled_interaction"));
    expect(questionManager.isActive()).toBe(false);
    expect(permissionManager.isActive()).toBe(false);
    expect(renameManager.isWaitingForName()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
    expect(mocked.abortMock).not.toHaveBeenCalled();
  });

  it("cancels scheduled task setup even when there is no active session", async () => {
    taskCreationManager.start(
      "project-1",
      "/repo/app",
      "global",
      "build",
      {
        providerID: "openai",
        modelID: "gpt-5",
        variant: "fast",
      },
      "global",
    );
    interactionManager.start({
      kind: "task",
      expectedInput: "text",
      metadata: { stage: "prompt" },
    });

    const replyMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      reply: replyMock,
    } as unknown as Context;

    await abortCommand(ctx as never);

    expect(replyMock).toHaveBeenCalledWith(t("stop.cancelled_interaction"));
    expect(taskCreationManager.isActive()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
    expect(mocked.abortMock).not.toHaveBeenCalled();
  });

  it("clears interaction state and aborts active session", async () => {
    activateInteractionState();

    mocked.currentSession = {
      id: "session-1",
      title: "Session",
      directory: "D:/repo",
    };

    mocked.abortMock.mockResolvedValue({ data: true, error: null });
    mocked.statusMock.mockResolvedValue({
      data: {
        "session-1": { type: "idle" },
      },
      error: null,
    });

    const replyMock = vi.fn().mockResolvedValue({ message_id: 88 });
    const editMessageTextMock = vi.fn().mockResolvedValue(undefined);

    const ctx = {
      chat: { id: 777 },
      reply: replyMock,
      api: {
        editMessageText: editMessageTextMock,
      },
    } as unknown as Context;

    await abortCommand(ctx as never);

    expect(replyMock).toHaveBeenCalledWith(t("stop.in_progress"));
    expect(mocked.abortMock).toHaveBeenCalled();
    expect(editMessageTextMock).toHaveBeenCalledWith(777, 88, t("stop.success"));

    expect(questionManager.isActive()).toBe(false);
    expect(permissionManager.isActive()).toBe(false);
    expect(renameManager.isWaitingForName()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("clears local busy state after a confirmed abort", async () => {
    mocked.currentSession = {
      id: "session-1",
      title: "Session",
      directory: "D:/repo",
    };

    assistantRunState.startRun("session-1", {
      startedAt: Date.now(),
      directory: "D:/repo",
    });
    activatePromptResponseMode("session-1", "text_only");

    mocked.abortMock.mockResolvedValue({ data: true, error: null });
    mocked.statusMock.mockResolvedValue({
      data: {
        "session-1": { type: "idle" },
      },
      error: null,
    });

    const ctx = {
      chat: { id: 777 },
      reply: vi.fn().mockResolvedValue({ message_id: 88 }),
      api: {
        editMessageText: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as Context;

    await abortCommand(ctx as never);

    expect(assistantRunState.getRun("session-1")).toBeNull();
    expect(consumePromptResponseMode("session-1")).toBeNull();
  });
});
