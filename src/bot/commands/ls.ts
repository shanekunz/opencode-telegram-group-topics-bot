import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CommandContext, Context, InlineKeyboard, InputFile } from "grammy";
import { getCurrentProject } from "../../settings/manager.js";
import { clearActiveInlineMenu, ensureActiveInlineMenu, replyWithInlineMenu } from "../handlers/inline-menu.js";
import { formatFileSize } from "../utils/file-download.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { getScopeFromContext, getScopeKeyFromContext, getThreadSendOptions } from "../scope.js";

const CALLBACK_PREFIX = "ls:";
const CALLBACK_NAV_PREFIX = "ls:nav:";
const CALLBACK_FILE_PREFIX = "ls:file:";
const CALLBACK_DOWNLOAD_PREFIX = "ls:download:";
const CALLBACK_BACK_PREFIX = "ls:back:";
const CALLBACK_PAGE_PREFIX = "ls:pg:";
const PAGE_SEPARATOR = "|";
const MAX_ENTRIES_PER_PAGE = 8;
const MAX_BUTTON_LABEL_LENGTH = 64;
const TELEGRAM_FILE_SIZE_LIMIT_BYTES = 20 * 1024 * 1024;

const sessionDirectories = new Map<string, string>();
const pathIndex = new Map<string, string>();
let pathCounter = 0;

interface LsEntry {
  name: string;
  fullPath: string;
  type: "file" | "directory";
}

interface FileDetails {
  name: string;
  fullPath: string;
  size: number;
  modified: Date;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncateLabel(label: string, maxLen: number = MAX_BUTTON_LABEL_LENGTH): string {
  if (label.length <= maxLen) {
    return label;
  }

  return `${label.slice(0, Math.max(0, maxLen - 3))}...`;
}

function pathToDisplayPath(absolutePath: string): string {
  const home = os.homedir();
  if (absolutePath === home) {
    return "~";
  }

  if (absolutePath.startsWith(home + path.sep)) {
    return `~${absolutePath.slice(home.length)}`;
  }

  return absolutePath;
}

function buildEntryLabel(entry: LsEntry): string {
  return `${entry.type === "directory" ? "📁" : "📄"} ${entry.name}`;
}

function isPathWithinDirectory(targetPath: string, directoryPath: string): boolean {
  const relativePath = path.relative(directoryPath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function getProjectRoot(scopeKey: string): string | null {
  return getCurrentProject(scopeKey)?.worktree ?? null;
}

function isWithinProjectRoot(targetPath: string, scopeKey: string): boolean {
  const projectRoot = getProjectRoot(scopeKey);
  return projectRoot !== null && isPathWithinDirectory(targetPath, projectRoot);
}

function isProjectRoot(targetPath: string, scopeKey: string): boolean {
  const projectRoot = getProjectRoot(scopeKey);
  return projectRoot !== null && targetPath === projectRoot;
}

function buildLsHeader(displayPath: string, totalCount: number, page: number, totalPages: number): string {
  let header = `📁 ${t("ls.header")}\n<code>${escapeHtml(displayPath)}</code>`;
  if (totalPages > 1) {
    header += `\n(${page + 1}/${totalPages})`;
  }

  header += `\n${t("ls.total", { count: totalCount })}`;
  return header;
}

function buildFileDetailsText(fileDetails: FileDetails): string {
  return (
    `📄 ${t("ls.file.header")}\n<code>${escapeHtml(fileDetails.name)}</code>\n` +
    `${t("commands.download.size")}: ${formatFileSize(fileDetails.size)}\n` +
    `${t("commands.download.modified")}: ${fileDetails.modified.toLocaleDateString()}`
  );
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

function encodePathWithPageCallback(prefix: string, fullPath: string, page: number): string {
  const pageSuffix = `${PAGE_SEPARATOR}${page}`;
  const reserveBytes = Buffer.byteLength(pageSuffix, "utf-8");
  return `${encodePathForCallback(prefix, fullPath, reserveBytes)}${pageSuffix}`;
}

function decodePathWithPageCallback(data: string, prefix: string): { path: string; page: number } | null {
  if (!data.startsWith(prefix)) {
    return null;
  }

  const payload = data.slice(prefix.length);
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
  return resolvedPath === null ? null : { path: resolvedPath, page };
}

function encodePaginationCallback(currentPath: string, page: number): string {
  return encodePathWithPageCallback(CALLBACK_PAGE_PREFIX, currentPath, page);
}

function decodePaginationCallback(data: string): { path: string; page: number } | null {
  return decodePathWithPageCallback(data, CALLBACK_PAGE_PREFIX);
}

function encodeFileCallback(fullPath: string, page: number): string {
  return encodePathWithPageCallback(CALLBACK_FILE_PREFIX, fullPath, page);
}

function decodeFileCallback(data: string): { path: string; page: number } | null {
  return decodePathWithPageCallback(data, CALLBACK_FILE_PREFIX);
}

function encodeBackCallback(directoryPath: string, page: number): string {
  return encodePathWithPageCallback(CALLBACK_BACK_PREFIX, directoryPath, page);
}

function decodeBackCallback(data: string): { path: string; page: number } | null {
  return decodePathWithPageCallback(data, CALLBACK_BACK_PREFIX);
}

async function scanDirectory(
  dirPath: string,
  scopeKey: string,
  page: number = 0,
): Promise<
  | {
      entries: LsEntry[];
      totalCount: number;
      currentPath: string;
      displayPath: string;
      hasParent: boolean;
      page: number;
    }
  | { error: string }
> {
  try {
    if (!isWithinProjectRoot(dirPath, scopeKey)) {
      return { error: t("ls.access_denied") };
    }

    const dirEntries = await fs.readdir(dirPath, { withFileTypes: true });
    const entries = dirEntries
      .map(
        (entry): LsEntry => ({
          name: entry.name,
          fullPath: path.join(dirPath, entry.name),
          type: entry.isDirectory() ? "directory" : "file",
        }),
      )
      .sort((left, right) => {
        if (left.type !== right.type) {
          return left.type === "directory" ? -1 : 1;
        }

        return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
      });

    const totalPages = Math.max(1, Math.ceil(entries.length / MAX_ENTRIES_PER_PAGE));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const startIndex = safePage * MAX_ENTRIES_PER_PAGE;

    return {
      entries: entries.slice(startIndex, startIndex + MAX_ENTRIES_PER_PAGE),
      totalCount: entries.length,
      currentPath: dirPath,
      displayPath: pathToDisplayPath(dirPath),
      hasParent: dirPath !== path.parse(dirPath).root,
      page: safePage,
    };
  } catch (error) {
    return {
      error: `${t("ls.scan_error")}: ${error instanceof Error ? error.message : t("common.unknown_error")}`,
    };
  }
}

function buildBrowseKeyboard(
  entries: LsEntry[],
  currentPath: string,
  hasParent: boolean,
  page: number,
  totalCount: number,
  scopeKey: string,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const totalPages = Math.max(1, Math.ceil(totalCount / MAX_ENTRIES_PER_PAGE));

  for (const entry of entries) {
    const callbackData =
      entry.type === "directory"
        ? encodePathForCallback(CALLBACK_NAV_PREFIX, entry.fullPath)
        : encodeFileCallback(entry.fullPath, page);
    keyboard.text(truncateLabel(buildEntryLabel(entry)), callbackData).row();
  }

  if (hasParent && !isProjectRoot(currentPath, scopeKey)) {
    keyboard.text(t("open.back"), encodePathForCallback(CALLBACK_NAV_PREFIX, path.dirname(currentPath))).row();
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

  return keyboard;
}

function buildFileDetailsKeyboard(filePath: string, page: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("ls.file.download"), encodePathForCallback(CALLBACK_DOWNLOAD_PREFIX, filePath))
    .text(t("ls.file.back"), encodeBackCallback(path.dirname(filePath), page));
}

async function renderBrowseView(dirPath: string, scopeKey: string, page: number = 0) {
  const result = await scanDirectory(dirPath, scopeKey, page);
  if ("error" in result) {
    return result;
  }

  const totalPages = Math.max(1, Math.ceil(result.totalCount / MAX_ENTRIES_PER_PAGE));
  return {
    text: buildLsHeader(result.displayPath, result.totalCount, result.page, totalPages),
    keyboard: buildBrowseKeyboard(
      result.entries,
      result.currentPath,
      result.hasParent,
      result.page,
      result.totalCount,
      scopeKey,
    ),
  };
}

async function getFileDetails(filePath: string, scopeKey: string): Promise<FileDetails | { error: string }> {
  try {
    if (!isWithinProjectRoot(filePath, scopeKey)) {
      return { error: t("ls.access_denied") };
    }

    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      return { error: t("commands.download.not_file") };
    }

    return {
      name: path.basename(filePath),
      fullPath: filePath,
      size: stat.size,
      modified: stat.mtime,
    };
  } catch (error) {
    return {
      error: `${t("ls.scan_error")}: ${error instanceof Error ? error.message : t("common.unknown_error")}`,
    };
  }
}

async function renderFileDetailsView(filePath: string, scopeKey: string, page: number) {
  const fileDetails = await getFileDetails(filePath, scopeKey);
  if ("error" in fileDetails) {
    return fileDetails;
  }

  return {
    text: buildFileDetailsText(fileDetails),
    keyboard: buildFileDetailsKeyboard(fileDetails.fullPath, page),
  };
}

function resolveTargetDirectory(scopeKey: string, rawArgs: string | undefined): string | null {
  const projectRoot = getProjectRoot(scopeKey);
  if (!projectRoot) {
    return null;
  }

  const args = rawArgs?.trim();
  if (args) {
    return path.resolve(projectRoot, args);
  }

  const cachedDirectory = sessionDirectories.get(scopeKey);
  if (cachedDirectory && isPathWithinDirectory(cachedDirectory, projectRoot)) {
    return cachedDirectory;
  }

  return projectRoot;
}

async function navigateTo(ctx: Context, scopeKey: string, dirPath: string, page: number = 0): Promise<void> {
  const view = await renderBrowseView(dirPath, scopeKey, page);
  if ("error" in view) {
    await ctx.answerCallbackQuery({ text: view.error });
    return;
  }

  sessionDirectories.set(scopeKey, dirPath);
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });
}

async function showFileDetails(ctx: Context, scopeKey: string, filePath: string, page: number): Promise<void> {
  const view = await renderFileDetailsView(filePath, scopeKey, page);
  if ("error" in view) {
    await ctx.answerCallbackQuery({ text: view.error });
    return;
  }

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });
}

async function downloadFileAndClose(ctx: Context, scopeKey: string, filePath: string): Promise<void> {
  const scope = getScopeFromContext(ctx);

  try {
    const fileDetails = await getFileDetails(filePath, scopeKey);
    if ("error" in fileDetails) {
      await ctx.answerCallbackQuery({ text: fileDetails.error });
      return;
    }

    if (fileDetails.size > TELEGRAM_FILE_SIZE_LIMIT_BYTES) {
      await ctx.answerCallbackQuery({ text: t("commands.download.file_too_large") });
      return;
    }

    await ctx.answerCallbackQuery({ text: t("commands.download.downloading") });

    const buffer = await fs.readFile(filePath);
    await ctx.api.sendDocument(ctx.chat!.id, new InputFile(buffer, fileDetails.name), {
      disable_notification: true,
      ...getThreadSendOptions(scope?.threadId ?? null),
    });

    clearActiveInlineMenu("ls_downloaded", scopeKey);
    clearLsPathIndex();
    await ctx.deleteMessage().catch(() => {});
  } catch (error) {
    logger.error("[Ls] Failed to download file", error);
    await ctx.answerCallbackQuery({ text: t("commands.download.error") }).catch(() => {});
  }
}

export function clearLsPathIndex(): void {
  pathIndex.clear();
  pathCounter = 0;
}

export function clearLsSessionDirectories(): void {
  sessionDirectories.clear();
}

export async function lsCommand(ctx: CommandContext<Context>): Promise<void> {
  try {
    const scopeKey = getScopeKeyFromContext(ctx);
    const scope = getScopeFromContext(ctx);

    clearLsPathIndex();

    const targetDir = resolveTargetDirectory(
      scopeKey,
      typeof ctx.match === "string" ? ctx.match : undefined,
    );
    if (!targetDir) {
      await ctx.reply(t("bot.project_not_selected"), getThreadSendOptions(scope?.threadId ?? null));
      return;
    }

    if (!isWithinProjectRoot(targetDir, scopeKey)) {
      await ctx.reply(t("ls.access_denied"), getThreadSendOptions(scope?.threadId ?? null));
      return;
    }

    const view = await renderBrowseView(targetDir, scopeKey);
    if ("error" in view) {
      await ctx.reply(view.error, getThreadSendOptions(scope?.threadId ?? null));
      return;
    }

    sessionDirectories.set(scopeKey, targetDir);
    await replyWithInlineMenu(ctx, {
      menuKind: "ls",
      text: view.text,
      keyboard: view.keyboard,
      parseMode: "HTML",
    });
  } catch (error) {
    logger.error("[Ls] Error opening directory browser", error);
    await ctx.reply(t("ls.open_error"), getThreadSendOptions(getScopeFromContext(ctx)?.threadId ?? null));
  }
}

export async function handleLsCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(CALLBACK_PREFIX)) {
    return false;
  }

  const scopeKey = getScopeKeyFromContext(ctx);
  const isActiveMenu = await ensureActiveInlineMenu(ctx, "ls");
  if (!isActiveMenu) {
    return true;
  }

  try {
    const navPath = decodePathFromCallback(CALLBACK_NAV_PREFIX, data);
    if (navPath !== null) {
      if (!isWithinProjectRoot(navPath, scopeKey)) {
        await ctx.answerCallbackQuery({ text: t("ls.access_denied") });
        return true;
      }

      await navigateTo(ctx, scopeKey, navPath);
      return true;
    }

    const pageInfo = decodePaginationCallback(data);
    if (pageInfo !== null) {
      if (!isWithinProjectRoot(pageInfo.path, scopeKey)) {
        await ctx.answerCallbackQuery({ text: t("ls.access_denied") });
        return true;
      }

      await navigateTo(ctx, scopeKey, pageInfo.path, pageInfo.page);
      return true;
    }

    const fileInfo = decodeFileCallback(data);
    if (fileInfo !== null) {
      if (!isWithinProjectRoot(fileInfo.path, scopeKey)) {
        await ctx.answerCallbackQuery({ text: t("ls.access_denied") });
        return true;
      }

      await showFileDetails(ctx, scopeKey, fileInfo.path, fileInfo.page);
      return true;
    }

    const downloadPath = decodePathFromCallback(CALLBACK_DOWNLOAD_PREFIX, data);
    if (downloadPath !== null) {
      if (!isWithinProjectRoot(downloadPath, scopeKey)) {
        await ctx.answerCallbackQuery({ text: t("ls.access_denied") });
        return true;
      }

      await downloadFileAndClose(ctx, scopeKey, downloadPath);
      return true;
    }

    const backInfo = decodeBackCallback(data);
    if (backInfo !== null) {
      if (!isWithinProjectRoot(backInfo.path, scopeKey)) {
        await ctx.answerCallbackQuery({ text: t("ls.access_denied") });
        return true;
      }

      await navigateTo(ctx, scopeKey, backInfo.path, backInfo.page);
      return true;
    }

    return false;
  } catch (error) {
    logger.error("[Ls] Error handling callback", error);
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    return true;
  }
}
