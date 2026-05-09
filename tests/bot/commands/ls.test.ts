import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  readdirMock: vi.fn(),
  statMock: vi.fn(),
  readFileMock: vi.fn(),
  getCurrentProjectMock: vi.fn(),
  ensureActiveInlineMenuMock: vi.fn().mockResolvedValue(true),
  replyWithInlineMenuMock: vi.fn().mockResolvedValue(42),
}));

vi.mock("node:fs", () => ({
  promises: {
    readdir: mocked.readdirMock,
    stat: mocked.statMock,
    readFile: mocked.readFileMock,
  },
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getCurrentProject: mocked.getCurrentProjectMock,
}));

vi.mock("../../../src/bot/handlers/inline-menu.js", () => ({
  clearActiveInlineMenu: vi.fn(),
  ensureActiveInlineMenu: mocked.ensureActiveInlineMenuMock,
  replyWithInlineMenu: mocked.replyWithInlineMenuMock,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  clearLsPathIndex,
  clearLsSessionDirectories,
  handleLsCallback,
  lsCommand,
} from "../../../src/bot/commands/ls.js";

function createCommandContext(match: string = ""): Context & { match?: string } {
  return {
    chat: { id: 123, type: "supergroup" },
    message: { text: "/ls", message_thread_id: 7 },
    match,
    reply: vi.fn().mockResolvedValue({ message_id: 42 }),
  } as unknown as Context & { match?: string };
}

function createCallbackContext(data: string, messageId: number = 42): Context {
  return {
    chat: { id: 123, type: "supergroup" },
    callbackQuery: {
      data,
      message: { message_id: messageId, message_thread_id: 7 },
    } as Context["callbackQuery"],
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    api: {
      sendDocument: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Context;
}

describe("bot/commands/ls", () => {
  beforeEach(() => {
    clearLsPathIndex();
    clearLsSessionDirectories();
    mocked.readdirMock.mockReset();
    mocked.statMock.mockReset();
    mocked.readFileMock.mockReset();
    mocked.getCurrentProjectMock.mockReset().mockImplementation((scopeKey?: string) => {
      if (scopeKey === "123:7") {
        return { id: "project-1", worktree: "/repo" };
      }

      return { id: "project-1", worktree: "/repo" };
    });
    mocked.ensureActiveInlineMenuMock.mockReset().mockResolvedValue(true);
    mocked.replyWithInlineMenuMock.mockReset().mockResolvedValue(42);
  });

  it("opens a scoped file browser for the current project", async () => {
    mocked.readdirMock.mockResolvedValue([
      { name: "src", isDirectory: () => true },
      { name: "README.md", isDirectory: () => false },
    ]);

    const ctx = createCommandContext();
    await lsCommand(ctx as never);

    expect(mocked.readdirMock).toHaveBeenCalledWith("/repo", { withFileTypes: true });
    expect(mocked.replyWithInlineMenuMock).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ menuKind: "ls", parseMode: "HTML" }),
    );
  });

  it("rejects paths outside the selected project", async () => {
    const ctx = createCommandContext("../../etc");

    await lsCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("ls.access_denied"), { message_thread_id: 7 });
    expect(mocked.replyWithInlineMenuMock).not.toHaveBeenCalled();
  });

  it("navigates into a directory from callback data", async () => {
    mocked.readdirMock.mockResolvedValue([{ name: "nested", isDirectory: () => true }]);
    const ctx = createCallbackContext("ls:nav:/repo/src");

    await expect(handleLsCallback(ctx)).resolves.toBe(true);

    expect(mocked.readdirMock).toHaveBeenCalledWith("/repo/src", { withFileTypes: true });
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining(t("ls.header")),
      expect.objectContaining({ parse_mode: "HTML" }),
    );
  });

  it("shows file details for file callbacks", async () => {
    mocked.statMock.mockResolvedValue({ isFile: () => true, size: 128, mtime: new Date("2026-05-09") });
    const ctx = createCallbackContext("ls:file:/repo/README.md|0");

    await expect(handleLsCallback(ctx)).resolves.toBe(true);

    expect(mocked.statMock).toHaveBeenCalledWith("/repo/README.md");
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining(t("ls.file.header")),
      expect.objectContaining({ parse_mode: "HTML" }),
    );
  });

  it("downloads a file and closes the menu", async () => {
    mocked.statMock.mockResolvedValue({ isFile: () => true, size: 128, mtime: new Date("2026-05-09") });
    mocked.readFileMock.mockResolvedValue(Buffer.from("hello"));
    const ctx = createCallbackContext("ls:download:/repo/README.md");

    await expect(handleLsCallback(ctx)).resolves.toBe(true);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("commands.download.downloading") });
    expect(ctx.api.sendDocument).toHaveBeenCalledTimes(1);
    expect(ctx.deleteMessage).toHaveBeenCalled();
  });
});
