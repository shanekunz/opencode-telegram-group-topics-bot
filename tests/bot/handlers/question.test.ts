import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { questionManager } from "../../../src/question/manager.js";
import { interactionManager } from "../../../src/interaction/manager.js";
import {
  handleQuestionCallback,
  handleQuestionTextAnswer,
  showCurrentQuestion,
} from "../../../src/bot/handlers/question.js";
import type { Question } from "../../../src/question/types.js";
import { t } from "../../../src/i18n/index.js";

vi.mock("../../../src/settings/manager.js", () => ({
  getCurrentProject: vi.fn(() => ({ worktree: "/tmp/project" })),
}));

vi.mock("../../../src/session/manager.js", () => ({
  getCurrentSession: vi.fn(() => null),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    question: {
      reply: vi.fn(() => Promise.resolve({ error: null })),
    },
  },
}));

vi.mock("../../../src/summary/aggregator.js", () => ({
  summaryAggregator: {
    clear: vi.fn(),
    stopTypingIndicator: vi.fn(),
  },
}));

vi.mock("../../../src/utils/safe-background-task.js", () => ({
  safeBackgroundTask: ({ task, onSuccess, onError }: {
    task: () => Promise<unknown>;
    onSuccess?: (value: unknown) => void;
    onError?: (error: unknown) => void;
  }) => {
    void task().then((value) => onSuccess?.(value)).catch((error) => onError?.(error));
  },
}));

const QUESTION_ONE: Question = {
  header: "Q1",
  question: "Pick one",
  options: [
    { label: "Yes", description: "accept" },
    { label: "No", description: "decline" },
  ],
};

const QUESTION_TWO: Question = {
  header: "Q2",
  question: "Second question",
  options: [
    { label: "Alpha", description: "first" },
    { label: "Beta", description: "second" },
  ],
};

const MULTIPLE_QUESTION: Question = {
  header: "Q multi",
  question: "Pick multiple",
  multiple: true,
  options: [
    { label: "One", description: "1" },
    { label: "Two", description: "2" },
  ],
};

function createApi(sendMessageIds: number[]): Context["api"] {
  let index = 0;

  return {
    sendMessage: vi.fn().mockImplementation(async () => {
      const messageId = sendMessageIds[index] ?? sendMessageIds[sendMessageIds.length - 1] ?? 1;
      index += 1;
      return { message_id: messageId };
    }),
    deleteMessage: vi.fn().mockResolvedValue(true),
  } as unknown as Context["api"];
}

function createCallbackContext(
  data: string,
  messageId: number,
  api: Context["api"],
  threadId?: number,
): Context {
  return {
    chat: { id: 123 },
    callbackQuery: {
      data,
      message: {
        message_id: messageId,
        ...(typeof threadId === "number" ? { message_thread_id: threadId } : {}),
      },
    } as Context["callbackQuery"],
    api,
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

function createTextContext(text: string, api: Context["api"]): Context {
  return {
    chat: { id: 123 },
    message: {
      text,
    } as Context["message"],
    api,
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

describe("bot/handlers/question", () => {
  beforeEach(() => {
    questionManager.clear();
    interactionManager.clear("test_setup");
  });

  it("starts question interaction in callback mode when showing question", async () => {
    const api = createApi([100]);

    questionManager.startQuestions([QUESTION_ONE], "req-1");
    await showCurrentQuestion(api, 123, "global", null);

    expect(questionManager.getActiveMessageId()).toBe(100);

    const state = interactionManager.getSnapshot();
    expect(state?.kind).toBe("question");
    expect(state?.expectedInput).toBe("callback");
    expect(state?.metadata.requestID).toBe("req-1");
    expect(state?.metadata.messageId).toBe(100);
    expect(state?.metadata.questionIndex).toBe(0);
  });

  it("switches to mixed mode on custom callback and accepts custom text", async () => {
    const api = createApi([101, 102]);

    questionManager.startQuestions([QUESTION_ONE, QUESTION_TWO], "req-2");
    await showCurrentQuestion(api, 123, "global", null);

    const customCtx = createCallbackContext("question:custom:0", 101, api);
    await handleQuestionCallback(customCtx);

    expect(questionManager.isWaitingForCustomInput(0)).toBe(true);
    expect(interactionManager.getSnapshot()?.expectedInput).toBe("mixed");

    const textCtx = createTextContext("My custom answer", api);
    await handleQuestionTextAnswer(textCtx);

    expect(questionManager.getCustomAnswer(0)).toBe("My custom answer");
    expect(questionManager.getCurrentIndex()).toBe(1);
    expect(questionManager.getActiveMessageId()).toBe(102);
    expect(interactionManager.getSnapshot()?.expectedInput).toBe("callback");

    expect(api.deleteMessage).toHaveBeenCalledWith(123, 101);
  });

  it("rejects stale callback from old question message", async () => {
    const api = createApi([200]);

    questionManager.startQuestions([QUESTION_ONE], "req-3");
    await showCurrentQuestion(api, 123, "global", null);

    const staleCtx = createCallbackContext("question:select:0:0", 199, api);
    const handled = await handleQuestionCallback(staleCtx);

    expect(handled).toBe(true);
    expect(staleCtx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("question.inactive_callback"),
      show_alert: true,
    });
    expect(questionManager.getSelectedOptions(0)).toEqual(new Set<number>());
  });

  it("cancels poll and clears question interaction", async () => {
    const api = createApi([300]);

    questionManager.startQuestions([QUESTION_ONE], "req-4");
    await showCurrentQuestion(api, 123, "global", null);

    const cancelCtx = createCallbackContext("question:cancel:0", 300, api);
    const handled = await handleQuestionCallback(cancelCtx);

    expect(handled).toBe(true);
    expect(cancelCtx.editMessageText).toHaveBeenCalledWith(t("question.cancelled"));
    expect(questionManager.isActive()).toBe(false);
    expect(questionManager.getTotalQuestions()).toBe(0);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("requires at least one selected option on multiple submit", async () => {
    const api = createApi([400]);

    questionManager.startQuestions([MULTIPLE_QUESTION], "req-5");
    await showCurrentQuestion(api, 123, "global", null);

    const submitCtx = createCallbackContext("question:submit:0", 400, api);
    const handled = await handleQuestionCallback(submitCtx);

    expect(handled).toBe(true);
    expect(submitCtx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("question.select_one_required_callback"),
      show_alert: true,
    });
    expect(questionManager.isActive()).toBe(true);
  });

  it("sends poll completion summary back into the originating topic", async () => {
    const api = createApi([500, 501]);
    const topicScope = "123:777";

    questionManager.startQuestions([QUESTION_ONE], "req-6", topicScope);
    await showCurrentQuestion(api, 123, topicScope, 777);

    const selectCtx = createCallbackContext("question:select:0:0", 500, api, 777);
    const handled = await handleQuestionCallback(selectCtx);

    expect(handled).toBe(true);
    expect(api.sendMessage).toHaveBeenNthCalledWith(
      2,
      123,
      expect.stringContaining("✅ Poll completed!"),
      { message_thread_id: 777 },
    );
    expect(questionManager.isActive(topicScope)).toBe(false);
  });
});
