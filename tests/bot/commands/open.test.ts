import type { Context } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  scanDirectoryMock: vi.fn(),
  pathToDisplayPathMock: vi.fn((value: string) => value.replace("/home/user", "~")),
  buildEntryLabelMock: vi.fn((entry: { name: string }) => `📁 ${entry.name}`),
  buildTreeHeaderMock: vi.fn((displayPath: string) => `📂 ${displayPath}`),
  isScanErrorMock: vi.fn(
    (result: unknown) => typeof result === "object" && result !== null && "error" in result,
  ),
  getBrowserRootsMock: vi.fn(() => ["/home/user"]),
  isWithinAllowedRootMock: vi.fn(() => true),
  isAllowedRootMock: vi.fn(() => false),
  ensureActiveInlineMenuMock: vi.fn().mockResolvedValue(true),
  replyWithInlineMenuMock: vi.fn().mockResolvedValue(42),
  upsertSessionDirectoryMock: vi.fn().mockResolvedValue(undefined),
  getProjectByWorktreeMock: vi.fn().mockResolvedValue({
    id: "proj-1",
    worktree: "/home/user/my-project",
    name: "my-project",
  }),
  switchToProjectMock: vi.fn().mockResolvedValue({ inline_keyboard: [[{ text: "mock" }]] }),
}));

vi.mock("../../../src/bot/utils/file-tree.js", () => ({
  pathToDisplayPath: mocked.pathToDisplayPathMock,
  scanDirectory: mocked.scanDirectoryMock,
  buildEntryLabel: mocked.buildEntryLabelMock,
  buildTreeHeader: mocked.buildTreeHeaderMock,
  isScanError: mocked.isScanErrorMock,
  MAX_ENTRIES_PER_PAGE: 8,
}));

vi.mock("../../../src/bot/utils/browser-roots.js", () => ({
  getBrowserRoots: mocked.getBrowserRootsMock,
  isWithinAllowedRoot: mocked.isWithinAllowedRootMock,
  isAllowedRoot: mocked.isAllowedRootMock,
}));

vi.mock("../../../src/bot/handlers/inline-menu.js", () => ({
  appendInlineMenuCancelButton: vi.fn((keyboard: unknown) => keyboard),
  ensureActiveInlineMenu: mocked.ensureActiveInlineMenuMock,
  replyWithInlineMenu: mocked.replyWithInlineMenuMock,
}));

vi.mock("../../../src/session/cache-manager.js", () => ({
  upsertSessionDirectory: mocked.upsertSessionDirectoryMock,
  __resetSessionDirectoryCacheForTests: vi.fn(),
}));

vi.mock("../../../src/project/manager.js", () => ({
  getProjectByWorktree: mocked.getProjectByWorktreeMock,
}));

vi.mock("../../../src/bot/utils/switch-project.js", () => ({
  switchToProject: mocked.switchToProjectMock,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  clearOpenPathIndex,
  handleOpenCallback,
  openCommand,
} from "../../../src/bot/commands/open.js";

function createCommandContext(): Context {
  return {
    chat: { id: 123, type: "private" },
    reply: vi.fn().mockResolvedValue({ message_id: 42 }),
  } as unknown as Context;
}

function createCallbackContext(data: string): Context {
  return {
    chat: { id: 123, type: "private" },
    callbackQuery: { data, message: { message_id: 42 } } as Context["callbackQuery"],
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    api: {},
  } as unknown as Context;
}

function makeScanResult(
  entries: Array<{ name: string; fullPath: string }>,
  currentPath: string,
  page: number = 0,
) {
  return {
    entries,
    totalCount: entries.length,
    page,
    currentPath,
    displayPath: currentPath.replace("/home/user", "~"),
    hasParent: true,
    parentPath: currentPath.replace(/\/[^/]+$/, "") || "/",
  };
}

describe("bot/commands/open", () => {
  beforeEach(() => {
    clearOpenPathIndex();
    mocked.scanDirectoryMock.mockReset();
    mocked.getBrowserRootsMock.mockReset().mockReturnValue(["/home/user"]);
    mocked.isWithinAllowedRootMock.mockReset().mockReturnValue(true);
    mocked.isAllowedRootMock.mockReset().mockReturnValue(false);
    mocked.ensureActiveInlineMenuMock.mockReset().mockResolvedValue(true);
    mocked.replyWithInlineMenuMock.mockReset().mockResolvedValue(42);
    mocked.upsertSessionDirectoryMock.mockReset().mockResolvedValue(undefined);
    mocked.getProjectByWorktreeMock.mockReset().mockResolvedValue({
      id: "proj-1",
      worktree: "/home/user/my-project",
      name: "my-project",
    });
    mocked.switchToProjectMock
      .mockReset()
      .mockResolvedValue({ inline_keyboard: [[{ text: "mock" }]] });
  });

  it("opens the browser from the only configured root", async () => {
    mocked.scanDirectoryMock.mockResolvedValue(
      makeScanResult([{ name: "projects", fullPath: "/home/user/projects" }], "/home/user"),
    );

    await openCommand(createCommandContext() as never);

    expect(mocked.scanDirectoryMock).toHaveBeenCalledWith("/home/user", 0);
    expect(mocked.replyWithInlineMenuMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ menuKind: "open" }),
    );
  });

  it("shows the root picker when multiple roots are configured", async () => {
    mocked.getBrowserRootsMock.mockReturnValue(["/home/user", "/opt/repos"]);

    await openCommand(createCommandContext() as never);

    expect(mocked.scanDirectoryMock).not.toHaveBeenCalled();
    expect(mocked.replyWithInlineMenuMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ text: t("open.select_root") }),
    );
  });

  it("reports browse errors returned by scanDirectory", async () => {
    const ctx = createCommandContext();
    mocked.scanDirectoryMock.mockResolvedValue({ error: "Permission denied", code: "EACCES" });

    await openCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(
      t("open.scan_error", { error: "Permission denied" }),
      {},
    );
  });

  it("ignores non-open callback data", async () => {
    await expect(handleOpenCallback(createCallbackContext("project:1"))).resolves.toBe(false);
  });

  it("navigates into a directory callback", async () => {
    mocked.scanDirectoryMock.mockResolvedValue(
      makeScanResult([{ name: "app", fullPath: "/home/user/projects/app" }], "/home/user/projects"),
    );
    const ctx = createCallbackContext("open:nav:/home/user/projects");

    await expect(handleOpenCallback(ctx)).resolves.toBe(true);
    expect(mocked.scanDirectoryMock).toHaveBeenCalledWith("/home/user/projects", 0);
    expect(ctx.editMessageText).toHaveBeenCalled();
  });

  it("blocks navigation outside allowed roots", async () => {
    mocked.isWithinAllowedRootMock.mockReturnValue(false);
    const ctx = createCallbackContext("open:nav:/etc");

    await expect(handleOpenCallback(ctx)).resolves.toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("open.access_denied") });
  });

  it("handles pagination callbacks", async () => {
    mocked.scanDirectoryMock.mockResolvedValue(makeScanResult([], "/home/user", 1));
    const ctx = createCallbackContext("open:pg:/home/user|1");

    await expect(handleOpenCallback(ctx)).resolves.toBe(true);
    expect(mocked.scanDirectoryMock).toHaveBeenCalledWith("/home/user", 1);
  });

  it("adds and selects a browsed directory as a project", async () => {
    const ctx = createCallbackContext("open:sel:/home/user/my-project");

    await expect(handleOpenCallback(ctx)).resolves.toBe(true);
    expect(mocked.upsertSessionDirectoryMock).toHaveBeenCalledWith(
      "/home/user/my-project",
      expect.any(Number),
    );
    expect(mocked.getProjectByWorktreeMock).toHaveBeenCalledWith("/home/user/my-project");
    expect(mocked.switchToProjectMock).toHaveBeenCalledWith(
      ctx,
      {
        id: "proj-1",
        worktree: "/home/user/my-project",
        name: "~/my-project",
      },
      "dm:123",
      "open_project_selected",
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("~/my-project"),
      expect.objectContaining({ reply_markup: expect.anything() }),
    );
    expect(ctx.deleteMessage).toHaveBeenCalled();
  });

  it("returns false for stale indexed paths after clearing the index", async () => {
    const longPath = `/home/user/${"x".repeat(60)}`;
    mocked.scanDirectoryMock.mockResolvedValue(
      makeScanResult([{ name: "x".repeat(60), fullPath: longPath }], "/home/user"),
    );

    await openCommand(createCommandContext() as never);
    const keyboard = mocked.replyWithInlineMenuMock.mock.calls[0]?.[1]?.keyboard;
    const callbackData = keyboard.inline_keyboard[0][0].callback_data as string;

    clearOpenPathIndex();

    await expect(handleOpenCallback(createCallbackContext(callbackData))).resolves.toBe(false);
  });
});
