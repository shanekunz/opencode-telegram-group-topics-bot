import path from "node:path";
import { CommandContext, Context, InlineKeyboard } from "grammy";
import {
  appendInlineMenuCancelButton,
  ensureActiveInlineMenu,
  replyWithInlineMenu,
} from "../handlers/inline-menu.js";
import {
  type DirectoryEntry,
  MAX_ENTRIES_PER_PAGE,
  buildEntryLabel,
  buildTreeHeader,
  isScanError,
  pathToDisplayPath,
  scanDirectory,
} from "../utils/file-tree.js";
import { getBrowserRoots, isAllowedRoot, isWithinAllowedRoot } from "../utils/browser-roots.js";
import { upsertSessionDirectory } from "../../session/cache-manager.js";
import { getProjectByWorktree } from "../../project/manager.js";
import { switchToProject } from "../utils/switch-project.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { getScopeFromContext, getScopeKeyFromContext, getThreadSendOptions } from "../scope.js";
import { BOT_I18N_KEY } from "../constants.js";
import { getProjectLockState } from "./projects.js";

const CALLBACK_PREFIX = "open:";
const CALLBACK_NAV_PREFIX = "open:nav:";
const CALLBACK_SELECT_PREFIX = "open:sel:";
const CALLBACK_PAGE_PREFIX = "open:pg:";
const CALLBACK_ROOTS = "open:roots";
const MAX_BUTTON_LABEL_LENGTH = 64;
const PAGE_SEPARATOR = "|";

const pathIndex = new Map<string, string>();
let pathCounter = 0;

function truncateLabel(label: string, maxLength: number = MAX_BUTTON_LABEL_LENGTH): string {
  if (label.length <= maxLength) {
    return label;
  }

  return `${label.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function clearOpenPathIndex(): void {
  pathIndex.clear();
  pathCounter = 0;
}

function encodePathForCallback(prefix: string, fullPath: string, reserveBytes: number = 0): string {
  const directValue = `${prefix}${fullPath}`;

  if (Buffer.byteLength(directValue, "utf-8") + reserveBytes <= 64) {
    return directValue;
  }

  const key = `#${pathCounter++}`;
  pathIndex.set(key, fullPath);
  return `${prefix}${key}`;
}

function decodePathFromCallback(prefix: string, data: string): string | null {
  if (!data.startsWith(prefix)) {
    return null;
  }

  const rawValue = data.slice(prefix.length);

  if (!rawValue.startsWith("#")) {
    return rawValue;
  }

  return pathIndex.get(rawValue) ?? null;
}

function encodePaginationCallback(currentPath: string, page: number): string {
  const pageSuffix = `${PAGE_SEPARATOR}${page}`;
  const reserveBytes = Buffer.byteLength(pageSuffix, "utf-8");
  const pathValue = encodePathForCallback(CALLBACK_PAGE_PREFIX, currentPath, reserveBytes);
  return `${pathValue}${pageSuffix}`;
}

function decodePaginationCallback(data: string): { path: string; page: number } | null {
  if (!data.startsWith(CALLBACK_PAGE_PREFIX)) {
    return null;
  }

  const payload = data.slice(CALLBACK_PAGE_PREFIX.length);
  const separatorIndex = payload.lastIndexOf(PAGE_SEPARATOR);

  if (separatorIndex < 0) {
    return null;
  }

  const rawPath = payload.slice(0, separatorIndex);
  const rawPage = payload.slice(separatorIndex + 1);
  const page = Number.parseInt(rawPage, 10);

  if (Number.isNaN(page)) {
    return null;
  }

  const resolvedPath = rawPath.startsWith("#") ? (pathIndex.get(rawPath) ?? null) : rawPath;

  if (resolvedPath === null) {
    return null;
  }

  return { path: resolvedPath, page };
}

function buildBrowseKeyboard(
  entries: DirectoryEntry[],
  currentPath: string,
  hasParent: boolean,
  page: number,
  totalCount: number,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const totalPages = Math.max(1, Math.ceil(totalCount / MAX_ENTRIES_PER_PAGE));

  for (const entry of entries) {
    keyboard
      .text(
        truncateLabel(buildEntryLabel(entry)),
        encodePathForCallback(CALLBACK_NAV_PREFIX, entry.fullPath),
      )
      .row();
  }

  const atRoot = isAllowedRoot(currentPath);
  const showUp = hasParent && !atRoot;
  const showRoots = getBrowserRoots().length > 1;

  if (showUp || showRoots) {
    if (showUp) {
      keyboard.text(
        t("open.back"),
        encodePathForCallback(CALLBACK_NAV_PREFIX, path.dirname(currentPath)),
      );
    }

    if (showRoots) {
      keyboard.text(t("open.roots"), CALLBACK_ROOTS);
    }

    keyboard.row();
  }

  if (totalPages > 1) {
    if (page > 0) {
      keyboard.text(t("open.prev_page"), encodePaginationCallback(currentPath, page - 1));
    }

    if (page < totalPages - 1) {
      keyboard.text(t("open.next_page"), encodePaginationCallback(currentPath, page + 1));
    }

    keyboard.row();
  }

  keyboard
    .text(t("open.select_current"), encodePathForCallback(CALLBACK_SELECT_PREFIX, currentPath))
    .row();

  return appendInlineMenuCancelButton(keyboard, "open");
}

async function renderBrowseView(dirPath: string, page: number = 0) {
  const result = await scanDirectory(dirPath, page);

  if (isScanError(result)) {
    return { error: result.error };
  }

  const totalPages = Math.max(1, Math.ceil(result.totalCount / MAX_ENTRIES_PER_PAGE));

  return {
    text: buildTreeHeader(result.displayPath, result.totalCount, result.page, totalPages),
    keyboard: buildBrowseKeyboard(
      result.entries,
      result.currentPath,
      result.hasParent,
      result.page,
      result.totalCount,
    ),
  };
}

function buildRootsKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const root of getBrowserRoots()) {
    keyboard
      .text(
        truncateLabel(`📂 ${pathToDisplayPath(root)}`),
        encodePathForCallback(CALLBACK_NAV_PREFIX, root),
      )
      .row();
  }

  return appendInlineMenuCancelButton(keyboard, "open");
}

function formatProjectLockMessage(ctx: Context, scopeKey: string): string | null {
  const lockState = getProjectLockState(ctx, scopeKey);

  if (!lockState.locked) {
    return null;
  }

  return lockState.messageKey === BOT_I18N_KEY.PROJECTS_LOCKED_GROUP_PROJECT
    ? t(BOT_I18N_KEY.PROJECTS_LOCKED_GROUP_PROJECT, {
        project: lockState.projectName ?? t("pinned.unknown"),
      })
    : t(BOT_I18N_KEY.PROJECTS_LOCKED_TOPIC_SCOPE);
}

export async function openCommand(ctx: CommandContext<Context>) {
  try {
    const scope = getScopeFromContext(ctx);
    const scopeKey = getScopeKeyFromContext(ctx);
    const lockMessage = formatProjectLockMessage(ctx, scopeKey);

    if (lockMessage) {
      await ctx.reply(lockMessage, getThreadSendOptions(scope?.threadId ?? null));
      return;
    }

    clearOpenPathIndex();

    const roots = getBrowserRoots();

    if (roots.length === 1) {
      const view = await renderBrowseView(roots[0]);

      if ("error" in view) {
        await ctx.reply(
          t("open.scan_error", { error: view.error }),
          getThreadSendOptions(scope?.threadId ?? null),
        );
        return;
      }

      await replyWithInlineMenu(ctx, {
        menuKind: "open",
        text: view.text,
        keyboard: view.keyboard,
      });
      return;
    }

    await replyWithInlineMenu(ctx, {
      menuKind: "open",
      text: t("open.select_root"),
      keyboard: buildRootsKeyboard(),
    });
  } catch (error) {
    logger.error("[Bot] Error opening directory browser:", error);
    await ctx.reply(
      t("open.open_error"),
      getThreadSendOptions(getScopeFromContext(ctx)?.threadId ?? null),
    );
  }
}

export async function handleOpenCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;

  if (!data || !data.startsWith(CALLBACK_PREFIX)) {
    return false;
  }

  const scope = getScopeFromContext(ctx);
  const scopeKey = getScopeKeyFromContext(ctx);
  const lockMessage = formatProjectLockMessage(ctx, scopeKey);

  if (lockMessage) {
    await ctx.answerCallbackQuery({
      text: t(BOT_I18N_KEY.PROJECTS_LOCKED_CALLBACK),
      show_alert: true,
    });
    return true;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "open");

  if (!isActiveMenu) {
    return true;
  }

  try {
    if (data === CALLBACK_ROOTS) {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(t("open.select_root"), { reply_markup: buildRootsKeyboard() });
      return true;
    }

    const navigationPath = decodePathFromCallback(CALLBACK_NAV_PREFIX, data);

    if (navigationPath !== null) {
      if (!isWithinAllowedRoot(navigationPath)) {
        await ctx.answerCallbackQuery({ text: t("open.access_denied") });
        return true;
      }

      const view = await renderBrowseView(navigationPath);

      if ("error" in view) {
        await ctx.answerCallbackQuery({ text: view.error });
        return true;
      }

      await ctx.answerCallbackQuery();
      await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
      return true;
    }

    const pagination = decodePaginationCallback(data);

    if (pagination !== null) {
      if (!isWithinAllowedRoot(pagination.path)) {
        await ctx.answerCallbackQuery({ text: t("open.access_denied") });
        return true;
      }

      const view = await renderBrowseView(pagination.path, pagination.page);

      if ("error" in view) {
        await ctx.answerCallbackQuery({ text: view.error });
        return true;
      }

      await ctx.answerCallbackQuery();
      await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
      return true;
    }

    const selectedPath = decodePathFromCallback(CALLBACK_SELECT_PREFIX, data);

    if (selectedPath === null) {
      return false;
    }

    if (!isWithinAllowedRoot(selectedPath)) {
      await ctx.answerCallbackQuery({ text: t("open.access_denied") });
      return true;
    }

    await upsertSessionDirectory(selectedPath, Date.now());
    const project = await getProjectByWorktree(selectedPath);
    const keyboard = await switchToProject(
      ctx,
      { ...project, name: pathToDisplayPath(selectedPath) },
      scopeKey,
      "open_project_selected",
    );

    await ctx.answerCallbackQuery();
    await ctx.reply(t("open.selected", { project: pathToDisplayPath(selectedPath) }), {
      reply_markup: keyboard,
      ...getThreadSendOptions(scope?.threadId ?? null),
    });
    await ctx.deleteMessage();
    clearOpenPathIndex();

    return true;
  } catch (error) {
    logger.error("[Bot] Error handling open callback:", error);
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") });
    await ctx.reply(t("open.select_error"), getThreadSendOptions(scope?.threadId ?? null));
    return true;
  }
}
