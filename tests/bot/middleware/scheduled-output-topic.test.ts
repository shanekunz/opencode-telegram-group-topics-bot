import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, NextFunction } from "grammy";
import { scheduledOutputTopicMiddleware } from "../../../src/bot/middleware/scheduled-output-topic.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  getScheduledTaskTopicByChatAndThreadMock: vi.fn(),
}));

vi.mock("../../../src/scheduled-task/store.js", () => ({
  getScheduledTaskTopicByChatAndThread: mocked.getScheduledTaskTopicByChatAndThreadMock,
}));

function createContext(text: string): Context {
  return {
    chat: {
      id: -100123,
      type: "supergroup",
    },
    message: {
      text,
      message_thread_id: 555,
    },
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

describe("bot/middleware/scheduled-output-topic", () => {
  beforeEach(() => {
    mocked.getScheduledTaskTopicByChatAndThreadMock.mockReset();
  });

  it("blocks most commands in scheduled output topics", async () => {
    mocked.getScheduledTaskTopicByChatAndThreadMock.mockResolvedValue({
      chatId: -100123,
      projectId: "project-1",
      projectWorktree: "/repo/app",
      threadId: 555,
      topicName: "⏰ Scheduled Task Output",
      createdAt: "2026-03-26T00:00:00.000Z",
      updatedAt: "2026-03-26T00:00:00.000Z",
    });
    const ctx = createContext("/last");
    const next = vi.fn() as unknown as NextFunction;

    await scheduledOutputTopicMiddleware(ctx, next);

    expect(ctx.reply).toHaveBeenCalledWith(t("task.output_topic_commands_only"), {
      message_thread_id: 555,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("allows help inside scheduled output topics", async () => {
    mocked.getScheduledTaskTopicByChatAndThreadMock.mockResolvedValue({
      chatId: -100123,
      projectId: "project-1",
      projectWorktree: "/repo/app",
      threadId: 555,
      topicName: "⏰ Scheduled Task Output",
      createdAt: "2026-03-26T00:00:00.000Z",
      updatedAt: "2026-03-26T00:00:00.000Z",
    });
    const ctx = createContext("/help");
    const next = vi.fn().mockResolvedValue(undefined) as unknown as NextFunction;

    await scheduledOutputTopicMiddleware(ctx, next);

    expect(ctx.reply).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
