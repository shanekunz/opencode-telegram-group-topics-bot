import path from "node:path";
import { CommandContext, Context, InlineKeyboard } from "grammy";
import {
  appendInlineMenuCancelButton,
  ensureActiveInlineMenu,
  replyWithInlineMenu,
} from "../handlers/inline-menu.js";
import {
  pathToDisplayPath,
  scanDirectory,
  buildEntryLabel,
  buildTreeHeader,
  isScanError,
  MAX_ENTRIES_PER_PAGE,
  type DirectoryEntry,
} from "../utils/file-tree.js";
import { getBrowserRoots, isWithinAllowedRoot, isAllowedRoot } from "../utils/browser-roots.js";
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

function truncateLabel(label: string, maxLen: number = MAX_BUTTON_LABEL_LENGTH): string {
  if (label.length <= maxLen) {
    return label;
  }

  return `${label.slice(0, Math.max(0, maxLen - 3))}...`;
}

export function clearOpenPathIndex(): void {
  pathIndex.clear();
  pathCounter = 0;
}

function encodePathForCallback(prefix: string, fullPath: string, reserveBytes: number = 0): string {
  const naive = `${prefix}${fullPath}`;
  if (Buffer.byteLength(naive, "utf-8") + reserveBytes <= 64) {
    return naive;
  }

  const key = `#${pathCounter++}`;
  pathIndex.set(key, fullPath);
  return `${prefix}${key}`;
}

function decodePathFromCallback(prefix: string, data: string): string | null {
  if (!data.startsWith(prefix)) {
    return null;
  }

  const raw = data.slice(prefix.length);
  if (raw.startsWith("#")) {
    return pathIndex.get(raw) ?? null;
  }

  return raw;
}

function encodePaginationCallback(currentPath: string, page: number): string {
  const pageSuffix = `${PAGE_SEPARATOR}${page}`;
  const reserveBytes = Buffer.byteLength(pageSuffix, "utf-8");
  const pathRef = encodePathForCallback(CALLBACK_PAGE_PREFIX, currentPath, reserveBytes);
  return `${pathRef}${pageSuffix}`;
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

  const pathRef = payload.slice(0, separatorIndex);
  const page = Number.parseInt(payload.slice(separatorIndex + 1), 10);
  if (Number.isNaN(page)) {
    return null;
  }

  const resolvedPath = pathRef.startsWith("#") ? (pathIndex.get(pathRef) ?? null) : pathRef;
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

  keyboard.text(
    t("open.select_current"),
    encodePathForCallback(CALLBACK_SELECT_PREFIX, currentPath),
  );

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

async function showRoots(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(t("open.select_root"), { reply_markup: buildRootsKeyboard() });
}

async function navigateTo(ctx: Context, dirPath: string, page: number = 0): Promise<void> {
  const view = await renderBrowseView(dirPath, page);
  if ("error" in view) {
    await ctx.answerCallbackQuery({ text: view.error });
    return;
  }

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
}

async function selectDirectory(ctx: Context, directory: string): Promise<void> {
  const displayPath = pathToDisplayPath(directory);
  const scope = getScopeFromContext(ctx);

  try {
    logger.info(`[Bot] Adding project directory: ${directory}`);

    await upsertSessionDirectory(directory, Date.now());
    const projectInfo = await getProjectByWorktree(directory);
    const replyKeyboard = await switchToProject(
      ctx,
      { ...projectInfo, name: displayPath },
      "open_project_selected",
    );

    await ctx.answerCallbackQuery();
    await ctx.reply(t("open.selected", { project: displayPath }), {
      reply_markup: replyKeyboard,
      ...getThreadSendOptions(scope?.threadId ?? null),
    });
    await ctx.deleteMessage();
    clearOpenPathIndex();
  } catch (error) {
    logger.error("[Bot] Error selecting directory:", error);
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") });
    await ctx.reply(t("open.select_error"), getThreadSendOptions(scope?.threadId ?? null));
  }
}

export async function openCommand(ctx: CommandContext<Context>): Promise<void> {
  try {
    const scopeKey = getScopeKeyFromContext(ctx);
    const lockState = getProjectLockState(ctx, scopeKey);
    if (lockState.locked) {
      const message =
        lockState.messageKey === BOT_I18N_KEY.PROJECTS_LOCKED_GROUP_PROJECT
          ? t(BOT_I18N_KEY.PROJECTS_LOCKED_GROUP_PROJECT, {
              project: lockState.projectName ?? t("pinned.unknown"),
            })
          : t(BOT_I18N_KEY.PROJECTS_LOCKED_TOPIC_SCOPE);
      await ctx.reply(message, getThreadSendOptions(getScopeFromContext(ctx)?.threadId ?? null));
      return;
    }

    clearOpenPathIndex();

    const roots = getBrowserRoots();
    if (roots.length === 1) {
      const view = await renderBrowseView(roots[0]);
      if ("error" in view) {
        await ctx.reply(t("open.scan_error", { error: view.error }));
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
    await ctx.reply(t("open.open_error"));
  }
}

export async function handleOpenCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(CALLBACK_PREFIX)) {
    return false;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "open");
  if (!isActiveMenu) {
    return true;
  }

  try {
    if (data === CALLBACK_ROOTS) {
      await showRoots(ctx);
      return true;
    }

    const navPath = decodePathFromCallback(CALLBACK_NAV_PREFIX, data);
    if (navPath !== null) {
      if (!isWithinAllowedRoot(navPath)) {
        await ctx.answerCallbackQuery({ text: t("open.access_denied") });
        return true;
      }

      await navigateTo(ctx, navPath);
      return true;
    }

    const pageInfo = decodePaginationCallback(data);
    if (pageInfo !== null) {
      if (!isWithinAllowedRoot(pageInfo.path)) {
        await ctx.answerCallbackQuery({ text: t("open.access_denied") });
        return true;
      }

      await navigateTo(ctx, pageInfo.path, pageInfo.page);
      return true;
    }

    const selectPath = decodePathFromCallback(CALLBACK_SELECT_PREFIX, data);
    if (selectPath !== null) {
      if (!isWithinAllowedRoot(selectPath)) {
        await ctx.answerCallbackQuery({ text: t("open.access_denied") });
        return true;
      }

      await selectDirectory(ctx, selectPath);
      return true;
    }

    return false;
  } catch (error) {
    logger.error("[Bot] Error handling open callback:", error);
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") });
    return true;
  }
}
