import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { t } from "../../../src/i18n/index.js";
import {
  handleCompactConfirm,
  handleContextButtonPress,
} from "../../../src/bot/handlers/context.js";

const mocked = vi.hoisted(() => ({
  getCurrentSessionMock: vi.fn(),
  replyWithInlineMenuMock: vi.fn(),
  ensureActiveInlineMenuMock: vi.fn(),
  clearActiveInlineMenuMock: vi.fn(),
  summarizeMock: vi.fn(),
  getStoredModelMock: vi.fn(),
  onSessionCompactedMock: vi.fn(),
  markPendingCompactionNoticeMock: vi.fn(),
}));

vi.mock("../../../src/session/manager.js", () => ({
  getCurrentSession: mocked.getCurrentSessionMock,
}));

vi.mock("../../../src/bot/handlers/inline-menu.js", () => ({
  clearActiveInlineMenu: mocked.clearActiveInlineMenuMock,
  ensureActiveInlineMenu: mocked.ensureActiveInlineMenuMock,
  replyWithInlineMenu: mocked.replyWithInlineMenuMock,
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      summarize: mocked.summarizeMock,
    },
  },
}));

vi.mock("../../../src/model/manager.js", () => ({
  getStoredModel: mocked.getStoredModelMock,
}));

vi.mock("../../../src/pinned/manager.js", () => ({
  pinnedMessageManager: {
    onSessionCompacted: mocked.onSessionCompactedMock,
  },
}));

vi.mock("../../../src/bot/utils/pending-compaction-notices.js", () => ({
  markPendingCompactionNotice: mocked.markPendingCompactionNoticeMock,
}));

function createMessageContext(options: { threadId?: number; isForum?: boolean }): Context {
  const { threadId, isForum = true } = options;

  return {
    chat: {
      id: -1001,
      type: "supergroup",
      is_forum: isForum,
    } as unknown as Context["chat"],
    message: {
      text: "📊",
      ...(typeof threadId === "number" ? { message_thread_id: threadId } : {}),
    } as unknown as Context["message"],
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

describe("bot/handlers/context", () => {
  beforeEach(() => {
    mocked.getCurrentSessionMock.mockReset();
    mocked.replyWithInlineMenuMock.mockReset();
    mocked.ensureActiveInlineMenuMock.mockReset();
    mocked.clearActiveInlineMenuMock.mockReset();
    mocked.summarizeMock.mockReset();
    mocked.getStoredModelMock.mockReset();
    mocked.onSessionCompactedMock.mockReset();
    mocked.markPendingCompactionNoticeMock.mockReset();
  });

  it("returns General-scope guidance instead of opening compact menu", async () => {
    const ctx = createMessageContext({ threadId: 1 });
    mocked.getCurrentSessionMock.mockReturnValue({
      id: "s1",
      title: "Session",
      directory: "/repo",
    });

    await handleContextButtonPress(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("context.general_not_available"), {});
    expect(mocked.replyWithInlineMenuMock).not.toHaveBeenCalled();
  });

  it("keeps existing no-session behavior in non-General topic", async () => {
    const ctx = createMessageContext({ threadId: 77 });
    mocked.getCurrentSessionMock.mockReturnValue(null);

    await handleContextButtonPress(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("context.no_active_session"), {
      message_thread_id: 77,
    });
    expect(mocked.replyWithInlineMenuMock).not.toHaveBeenCalled();
  });

  it("refreshes pinned state immediately after successful compaction", async () => {
    mocked.ensureActiveInlineMenuMock.mockResolvedValue(true);
    mocked.getCurrentSessionMock.mockReturnValue({
      id: "s1",
      title: "Session",
      directory: "/repo",
    });
    mocked.getStoredModelMock.mockReturnValue({ providerID: "openai", modelID: "gpt-5" });
    mocked.summarizeMock.mockResolvedValue({ error: null });
    mocked.onSessionCompactedMock.mockResolvedValue(undefined);

    const ctx = {
      callbackQuery: { data: "compact:confirm", message: { message_thread_id: 77 } },
      chat: { id: -1001, type: "supergroup", is_forum: true },
      api: {
        sendChatAction: vi.fn().mockResolvedValue(true),
        editMessageText: vi.fn().mockResolvedValue(true),
      },
      answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
      deleteMessage: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue({ message_id: 10 }),
    } as unknown as Context;

    await handleCompactConfirm(ctx);

    expect(mocked.markPendingCompactionNoticeMock).toHaveBeenCalledWith("s1");
  });
});
