import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { lastCommand } from "../../../src/bot/commands/last.js";
import { t } from "../../../src/i18n/index.js";
import { questionManager } from "../../../src/question/manager.js";

const mocked = vi.hoisted(() => ({
  getCurrentProjectMock: vi.fn(),
  getCurrentSessionMock: vi.fn(),
  sessionMessagesMock: vi.fn(),
  showCurrentQuestionMock: vi.fn(),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getCurrentProject: mocked.getCurrentProjectMock,
}));

vi.mock("../../../src/session/manager.js", () => ({
  getCurrentSession: mocked.getCurrentSessionMock,
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      messages: mocked.sessionMessagesMock,
    },
  },
}));

vi.mock("../../../src/bot/handlers/question.js", () => ({
  showCurrentQuestion: mocked.showCurrentQuestionMock,
}));

describe("bot/commands/last", () => {
  beforeEach(() => {
    questionManager.clear();
    mocked.getCurrentProjectMock.mockReset();
    mocked.getCurrentSessionMock.mockReset();
    mocked.sessionMessagesMock.mockReset();
    mocked.showCurrentQuestionMock.mockReset();

    mocked.getCurrentProjectMock.mockReturnValue({ id: "project-1", worktree: "/repo" });
    mocked.getCurrentSessionMock.mockReturnValue({
      id: "session-1",
      title: "Session",
      directory: "/repo",
    });
    mocked.sessionMessagesMock.mockResolvedValue({
      data: [
        {
          info: { role: "assistant", time: { created: 2 } },
          parts: [{ type: "text", text: "Latest agent reply" }],
        },
      ],
      error: null,
    });
  });

  it("shows the latest visible turn in the current thread", async () => {
    const replyMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      chat: { id: -100, type: "supergroup" },
      message: { text: "/last", message_thread_id: 22 },
      reply: replyMock,
    } as unknown as Context;

    await lastCommand(ctx as never);

    expect(mocked.sessionMessagesMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      directory: "/repo",
      limit: 50,
    });
    expect(replyMock).toHaveBeenCalledWith(
      `${t("last.title")}\n\n${t("sessions.preview.agent")} Latest agent reply`,
      { message_thread_id: 22 },
    );
  });

  it("prefers the most recent assistant reply over a newer user-only turn", async () => {
    mocked.sessionMessagesMock.mockResolvedValueOnce({
      data: [
        {
          info: { role: "user", time: { created: 3 } },
          parts: [{ type: "text", text: "My latest message" }],
        },
        {
          info: { role: "assistant", time: { created: 2 } },
          parts: [{ type: "text", text: "Latest completed agent reply" }],
        },
      ],
      error: null,
    });
    const replyMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      chat: { id: -100, type: "supergroup" },
      message: { text: "/last", message_thread_id: 22 },
      reply: replyMock,
    } as unknown as Context;

    await lastCommand(ctx as never);

    expect(replyMock).toHaveBeenCalledWith(
      `${t("last.title")}\n\n${t("sessions.preview.agent")} Latest completed agent reply`,
      { message_thread_id: 22 },
    );
  });

  it("returns an empty state when there are no visible messages", async () => {
    mocked.sessionMessagesMock.mockResolvedValue({ data: [], error: null });
    const replyMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      chat: { id: 42, type: "private" },
      message: { text: "/last" },
      reply: replyMock,
    } as unknown as Context;

    await lastCommand(ctx as never);

    expect(replyMock).toHaveBeenCalledWith(t("last.empty"), {});
  });

  it("uses the session directory instead of the current project worktree", async () => {
    mocked.getCurrentProjectMock.mockReturnValue({ id: "project-1", worktree: "/other-repo" });
    const replyMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      chat: { id: 42, type: "private" },
      message: { text: "/last" },
      reply: replyMock,
    } as unknown as Context;

    await lastCommand(ctx as never);

    expect(mocked.sessionMessagesMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      directory: "/repo",
      limit: 50,
    });
  });

  it("keeps fetch errors in the active thread", async () => {
    mocked.getCurrentProjectMock.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const replyMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      chat: { id: -100, type: "supergroup" },
      message: { text: "/last", message_thread_id: 22 },
      reply: replyMock,
    } as unknown as Context;

    await lastCommand(ctx as never);

    expect(replyMock).toHaveBeenCalledWith(t("last.fetch_error"), { message_thread_id: 22 });
  });

  it("re-shows the active question when it was dismissed", async () => {
    questionManager.startQuestions(
      [
        {
          header: "Q1",
          question: "Pick one",
          options: [{ label: "Yes", description: "accept" }],
        },
      ],
      "req-1",
      "-100:22",
    );
    questionManager.clearActiveMessage("-100:22");

    const replyMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      chat: { id: -100, type: "supergroup" },
      api: {},
      message: { text: "/last", message_thread_id: 22 },
      reply: replyMock,
    } as unknown as Context;

    await lastCommand(ctx as never);

    expect(mocked.showCurrentQuestionMock).toHaveBeenCalledWith(ctx.api, -100, "-100:22", 22);
    expect(replyMock).not.toHaveBeenCalled();
    expect(mocked.sessionMessagesMock).not.toHaveBeenCalled();
  });
});
