import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  scanDirectoryMock: vi.fn(),
  pathToDisplayPathMock: vi.fn((value: string) => value.replace("/home/user", "~")),
  buildEntryLabelMock: vi.fn((entry: { name: string }) => `📁 ${entry.name}`),
  buildTreeHeaderMock: vi.fn((display: string) => `📂 ${display}`),
  isScanErrorMock: vi.fn(
    (result: unknown) => typeof result === "object" && result !== null && "error" in result,
  ),
  getBrowserRootsMock: vi.fn(() => ["/home/user"]),
  isWithinAllowedRootMock: vi.fn(() => true),
  isAllowedRootMock: vi.fn(() => false),
  ensureActiveInlineMenuMock: vi.fn().mockResolvedValue(true),
  replyWithInlineMenuMock: vi.fn().mockResolvedValue(42),
  appendInlineMenuCancelButtonMock: vi.fn((keyboard: unknown) => keyboard),
  upsertSessionDirectoryMock: vi.fn().mockResolvedValue(undefined),
  getProjectByWorktreeMock: vi.fn().mockResolvedValue({
    id: "proj-1",
    worktree: "/home/user/my-project",
    name: "my-project",
  }),
  switchToProjectMock: vi.fn().mockResolvedValue({ keyboard: [[{ text: "mock" }]] }),
  getProjectLockStateMock: vi.fn(() => ({ locked: false })),
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
  appendInlineMenuCancelButton: mocked.appendInlineMenuCancelButtonMock,
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

vi.mock("../../../src/bot/commands/projects.js", () => ({
  getProjectLockState: mocked.getProjectLockStateMock,
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
    chat: { id: 123 },
    reply: vi.fn().mockResolvedValue({ message_id: 42 }),
  } as unknown as Context;
}

function createCallbackContext(data: string, messageId: number = 42): Context {
  return {
    chat: { id: 123 },
    callbackQuery: {
      data,
      message: { message_id: messageId },
    } as Context["callbackQuery"],
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
  hasParent: boolean = true,
  page: number = 0,
) {
  return {
    entries,
    totalCount: entries.length,
    page,
    currentPath,
    displayPath: currentPath.replace("/home/user", "~"),
    hasParent,
    parentPath: hasParent ? currentPath.replace(/\/[^/]+$/, "") || "/" : null,
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
    mocked.switchToProjectMock.mockReset().mockResolvedValue({ keyboard: [[{ text: "mock" }]] });
    mocked.getProjectLockStateMock.mockReset().mockReturnValue({ locked: false });
  });

  it("shows a directory browser when a single root is configured", async () => {
    mocked.scanDirectoryMock.mockResolvedValue(
      makeScanResult([{ name: "projects", fullPath: "/home/user/projects" }], "/home/user"),
    );

    const ctx = createCommandContext();
    await openCommand(ctx as never);

    expect(mocked.scanDirectoryMock).toHaveBeenCalledWith("/home/user", 0);
    expect(mocked.replyWithInlineMenuMock).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ menuKind: "open" }),
    );
  });

  it("shows root selection when multiple roots are configured", async () => {
    mocked.getBrowserRootsMock.mockReturnValue(["/home/user", "/opt/repos"]);

    const ctx = createCommandContext();
    await openCommand(ctx as never);

    expect(mocked.scanDirectoryMock).not.toHaveBeenCalled();
    expect(mocked.replyWithInlineMenuMock).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ text: t("open.select_root"), menuKind: "open" }),
    );
  });

  it("blocks in locked project scopes", async () => {
    mocked.getProjectLockStateMock.mockReturnValue({
      locked: true,
      messageKey: "projects.locked.topic_scope",
    });

    const ctx = createCommandContext();
    await openCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("projects.locked.topic_scope"), {});
  });

  it("returns false for non-open callback data", async () => {
    await expect(handleOpenCallback(createCallbackContext("project:abc"))).resolves.toBe(false);
  });

  it("shows root selection on open:roots callback", async () => {
    mocked.getBrowserRootsMock.mockReturnValue(["/home/user", "/opt/repos"]);
    const ctx = createCallbackContext("open:roots");

    await expect(handleOpenCallback(ctx)).resolves.toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith();
    expect(ctx.editMessageText).toHaveBeenCalled();
  });

  it("denies navigation outside allowed roots", async () => {
    mocked.isWithinAllowedRootMock.mockReturnValue(false);
    const ctx = createCallbackContext("open:nav:/etc");

    await expect(handleOpenCallback(ctx)).resolves.toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("open.access_denied") });
  });

  it("navigates into a directory", async () => {
    mocked.scanDirectoryMock.mockResolvedValue(
      makeScanResult(
        [{ name: "my-app", fullPath: "/home/user/projects/my-app" }],
        "/home/user/projects",
      ),
    );
    const ctx = createCallbackContext("open:nav:/home/user/projects");

    await expect(handleOpenCallback(ctx)).resolves.toBe(true);
    expect(mocked.scanDirectoryMock).toHaveBeenCalledWith("/home/user/projects", 0);
    expect(ctx.editMessageText).toHaveBeenCalled();
  });

  it("handles pagination callbacks", async () => {
    mocked.scanDirectoryMock.mockResolvedValue(
      makeScanResult([{ name: "z-dir", fullPath: "/home/user/z-dir" }], "/home/user"),
    );
    const ctx = createCallbackContext("open:pg:/home/user|1");

    await expect(handleOpenCallback(ctx)).resolves.toBe(true);
    expect(mocked.scanDirectoryMock).toHaveBeenCalledWith("/home/user", 1);
  });

  it("selects a directory as a project", async () => {
    const ctx = createCallbackContext("open:sel:/home/user/my-project");

    await expect(handleOpenCallback(ctx)).resolves.toBe(true);
    expect(mocked.upsertSessionDirectoryMock).toHaveBeenCalledWith(
      "/home/user/my-project",
      expect.any(Number),
    );
    expect(mocked.switchToProjectMock).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("~"),
      expect.objectContaining({ reply_markup: expect.anything() }),
    );
    expect(ctx.deleteMessage).toHaveBeenCalled();
  });

  it("shows an error when selecting a directory fails", async () => {
    mocked.getProjectByWorktreeMock.mockRejectedValue(new Error("not found"));
    const ctx = createCallbackContext("open:sel:/home/user/bad-dir");

    await expect(handleOpenCallback(ctx)).resolves.toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("callback.processing_error") });
    expect(ctx.reply).toHaveBeenCalledWith(t("open.select_error"), {});
  });

  it("invalidates indexed paths after reset", async () => {
    const longPath = `/home/user/${"a".repeat(60)}`;
    mocked.scanDirectoryMock.mockResolvedValue(
      makeScanResult([{ name: "a".repeat(60), fullPath: longPath }], "/home/user"),
    );

    const ctx = createCommandContext();
    await openCommand(ctx as never);

    const [, options] = mocked.replyWithInlineMenuMock.mock.calls[0];
    const callbackData = options.keyboard.inline_keyboard[0][0].callback_data as string;

    expect(callbackData).toMatch(/open:nav:#\d+/);

    clearOpenPathIndex();
    await expect(handleOpenCallback(createCallbackContext(callbackData))).resolves.toBe(false);
  });
});
