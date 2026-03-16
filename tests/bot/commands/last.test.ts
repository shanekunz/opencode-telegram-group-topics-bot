import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { lastCommand } from "../../../src/bot/commands/last.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  getCurrentProjectMock: vi.fn(),
  getCurrentSessionMock: vi.fn(),
  sessionMessagesMock: vi.fn(),
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

describe("bot/commands/last", () => {
  beforeEach(() => {
    mocked.getCurrentProjectMock.mockReset();
    mocked.getCurrentSessionMock.mockReset();
    mocked.sessionMessagesMock.mockReset();

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

  it("returns an empty state when there are no visible messages", async () => {
    mocked.sessionMessagesMock.mockResolvedValueOnce({ data: [], error: null });
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
});
