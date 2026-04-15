import { CommandContext, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getCurrentProject } from "../../settings/manager.js";
import { getProjects } from "../../project/manager.js";
import { syncSessionDirectoryCache } from "../../session/cache-manager.js";
import { clearAllInteractionState } from "../../interaction/cleanup.js";
import { INTERACTION_CLEAR_REASON } from "../../interaction/constants.js";
import { switchToProject } from "../utils/switch-project.js";
import {
  appendInlineMenuCancelButton,
  ensureActiveInlineMenu,
  replyWithInlineMenu,
} from "../handlers/inline-menu.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { config } from "../../config.js";
import { ProjectInfo } from "../../settings/manager.js";
import {
  GLOBAL_SCOPE_KEY,
  SCOPE_CONTEXT,
  getScopeFromContext,
  getScopeKeyFromContext,
  getThreadSendOptions,
} from "../scope.js";
import { BOT_I18N_KEY } from "../constants.js";

const MAX_INLINE_BUTTON_LABEL_LENGTH = 64;
const PROJECT_PAGE_CALLBACK_PREFIX = "projects:page:";
const PROJECT_SELECT_CALLBACK_PREFIX = "project:";

interface ProjectsPaginationRange {
  page: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
}

export interface ProjectLockState {
  locked: boolean;
  messageKey?: string;
  projectName?: string;
}

function formatProjectButtonLabel(label: string, isActive: boolean): string {
  const prefix = isActive ? "✅ " : "";
  const availableLength = MAX_INLINE_BUTTON_LABEL_LENGTH - prefix.length;

  if (label.length <= availableLength) {
    return `${prefix}${label}`;
  }

  return `${prefix}${label.slice(0, Math.max(0, availableLength - 3))}...`;
}

export function getProjectFolderName(worktree: string): string {
  const normalized = worktree.replace(/[\\/]+$/g, "");

  if (!normalized) {
    return worktree;
  }

  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? normalized;
}

export function buildProjectButtonLabel(index: number, worktree: string): string {
  const folderName = getProjectFolderName(worktree);
  return `${index + 1}. ${folderName} [${worktree}]`;
}

export function parseProjectPageCallback(data: string): number | null {
  if (!data.startsWith(PROJECT_PAGE_CALLBACK_PREFIX)) {
    return null;
  }

  const rawPage = data.slice(PROJECT_PAGE_CALLBACK_PREFIX.length);
  if (!/^\d+$/.test(rawPage)) {
    return null;
  }

  return Number.parseInt(rawPage, 10);
}

export function calculateProjectsPaginationRange(
  totalProjects: number,
  page: number,
  pageSize: number,
): ProjectsPaginationRange {
  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(totalProjects / safePageSize));
  const normalizedPage = Math.min(Math.max(0, page), totalPages - 1);
  const startIndex = normalizedPage * safePageSize;
  const endIndex = Math.min(startIndex + safePageSize, totalProjects);

  return {
    page: normalizedPage,
    totalPages,
    startIndex,
    endIndex,
  };
}

function buildProjectsMenuText(
  currentProjectName: string | null,
  page: number,
  totalPages: number,
): string {
  const baseText = currentProjectName
    ? t("projects.select_with_current", {
        project: currentProjectName,
      })
    : t("projects.select");

  if (totalPages <= 1) {
    return baseText;
  }

  return `${baseText}\n\n${t("projects.page_indicator", {
    current: String(page + 1),
    total: String(totalPages),
  })}`;
}

function buildProjectsKeyboard(
  projects: ProjectInfo[],
  page: number,
  scopeKey: string,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const currentProject = getCurrentProject(scopeKey);
  const pageSize = config.bot.projectsListLimit;
  const {
    page: normalizedPage,
    totalPages,
    startIndex,
    endIndex,
  } = calculateProjectsPaginationRange(projects.length, page, pageSize);

  projects.slice(startIndex, endIndex).forEach((project, index) => {
    const isActive =
      currentProject &&
      (project.id === currentProject.id || project.worktree === currentProject.worktree);
    const label = buildProjectButtonLabel(startIndex + index, project.worktree);
    const labelWithCheck = formatProjectButtonLabel(label, Boolean(isActive));
    keyboard.text(labelWithCheck, `project:${project.id}`).row();
  });

  if (totalPages > 1) {
    if (normalizedPage > 0) {
      keyboard.text(
        t("projects.prev_page"),
        `${PROJECT_PAGE_CALLBACK_PREFIX}${normalizedPage - 1}`,
      );
    }

    if (normalizedPage < totalPages - 1) {
      keyboard.text(
        t("projects.next_page"),
        `${PROJECT_PAGE_CALLBACK_PREFIX}${normalizedPage + 1}`,
      );
    }
  }

  return keyboard;
}

function buildProjectsMenuView(
  projects: ProjectInfo[],
  page: number,
  scopeKey: string,
): { text: string; keyboard: InlineKeyboard } {
  const currentProject = getCurrentProject(scopeKey);
  const pageSize = config.bot.projectsListLimit;
  const { page: normalizedPage, totalPages } = calculateProjectsPaginationRange(
    projects.length,
    page,
    pageSize,
  );
  const currentProjectName = currentProject?.name || currentProject?.worktree || null;

  return {
    text: buildProjectsMenuText(currentProjectName, normalizedPage, totalPages),
    keyboard: buildProjectsKeyboard(projects, normalizedPage, scopeKey),
  };
}

function clearInteractionWithScope(reason: string, scopeKey: string): void {
  if (scopeKey === GLOBAL_SCOPE_KEY) {
    clearAllInteractionState(reason);
    return;
  }

  clearAllInteractionState(reason, scopeKey);
}


export function getProjectLockState(ctx: Context, _scopeKey: string): ProjectLockState {
  if (!ctx.chat) {
    return { locked: false };
  }

  const scope = getScopeFromContext(ctx);
  if (scope?.context === SCOPE_CONTEXT.GROUP_TOPIC) {
    return {
      locked: true,
      messageKey: BOT_I18N_KEY.PROJECTS_LOCKED_TOPIC_SCOPE,
    };
  }

  // General topic and non-forum chats are never locked — users can switch
  // projects freely there. Each session topic is bound to the project that
  // was active when the topic was created (handled by the GROUP_TOPIC check
  // above), so different topics can belong to different projects.
  return { locked: false };
}

export async function projectsCommand(ctx: CommandContext<Context>) {
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

    await syncSessionDirectoryCache();
    const projects = await getProjects();

    if (projects.length === 0) {
      await ctx.reply(t("projects.empty"));
      return;
    }

    const { text, keyboard } = buildProjectsMenuView(projects, 0, scopeKey);

    await replyWithInlineMenu(ctx, {
      menuKind: "project",
      text,
      keyboard,
    });
  } catch (error) {
    logger.error("[Bot] Error fetching projects:", error);
    await ctx.reply(t("projects.fetch_error"));
  }
}

export async function handleProjectSelect(ctx: Context): Promise<boolean> {
  const scopeKey = getScopeKeyFromContext(ctx);
  const scope = getScopeFromContext(ctx);
  const callbackQuery = ctx.callbackQuery;
  if (!callbackQuery?.data) {
    return false;
  }

  const page = parseProjectPageCallback(callbackQuery.data);
  if (page !== null) {
    const lockState = getProjectLockState(ctx, scopeKey);
    if (lockState.locked) {
      await ctx.answerCallbackQuery({
        text: t(BOT_I18N_KEY.PROJECTS_LOCKED_CALLBACK),
        show_alert: true,
      });
      return true;
    }

    const isActiveMenu = await ensureActiveInlineMenu(ctx, "project");
    if (!isActiveMenu) {
      return true;
    }

    try {
      const projects = await getProjects();
      if (projects.length === 0) {
        await ctx.answerCallbackQuery();
        await ctx.reply(t("projects.empty"), getThreadSendOptions(scope?.threadId ?? null));
        return true;
      }

      const { text, keyboard } = buildProjectsMenuView(projects, page, scopeKey);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(text, {
        reply_markup: appendInlineMenuCancelButton(keyboard, "project"),
      });
    } catch (error) {
      logger.error("[Bot] Error switching projects page:", error);
      await ctx.answerCallbackQuery({ text: t("projects.page_load_error") });
    }

    return true;
  }

  if (!callbackQuery.data.startsWith(PROJECT_SELECT_CALLBACK_PREFIX)) {
    return false;
  }

  const lockState = getProjectLockState(ctx, scopeKey);
  if (lockState.locked) {
    await ctx.answerCallbackQuery({
      text: t(BOT_I18N_KEY.PROJECTS_LOCKED_CALLBACK),
      show_alert: true,
    });
    return true;
  }

  const projectId = callbackQuery.data.replace(PROJECT_SELECT_CALLBACK_PREFIX, "");

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "project");
  if (!isActiveMenu) {
    return true;
  }

  try {
    const projects = await getProjects();
    const selectedProject = projects.find((p) => p.id === projectId);

    if (!selectedProject) {
      throw new Error(`Project with id ${projectId} not found`);
    }

    logger.info(
      `[Bot] Project selected: ${selectedProject.name || selectedProject.worktree} (id: ${projectId})`,
    );

    const scopedKeyboard = await switchToProject(
      ctx,
      selectedProject,
      INTERACTION_CLEAR_REASON.PROJECT_SWITCHED,
    );

    const projectName = selectedProject.name || selectedProject.worktree;

    await ctx.answerCallbackQuery();
    await ctx.reply(t("projects.selected", { project: projectName }), {
      reply_markup: scopedKeyboard,
      ...getThreadSendOptions(scope?.threadId ?? null),
    });

    await ctx.deleteMessage();
  } catch (error) {
    clearInteractionWithScope(INTERACTION_CLEAR_REASON.PROJECT_SELECT_ERROR, scopeKey);
    logger.error("[Bot] Error selecting project:", error);
    await ctx.answerCallbackQuery();
    await ctx.reply(t("projects.select_error"), getThreadSendOptions(scope?.threadId ?? null));
  }

  return true;
}
