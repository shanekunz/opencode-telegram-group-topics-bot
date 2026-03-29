import type { CommandContext, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { t } from "../../i18n/index.js";
import { getCurrentProject } from "../../settings/manager.js";
import {
  appendInlineMenuCancelButton,
  clearActiveInlineMenu,
  ensureActiveInlineMenu,
  replyWithInlineMenu,
} from "../handlers/inline-menu.js";
import { getScopeKeyFromContext } from "../scope.js";
import { logger } from "../../utils/logger.js";
import { formatTaskListBadge } from "../../scheduled-task/display.js";
import { listScheduledTasks, removeScheduledTask } from "../../scheduled-task/store.js";
import type { ScheduledTask } from "../../scheduled-task/types.js";

const TASKLIST_DELETE_CALLBACK_PREFIX = "tasklist:delete:";

function getScopedScheduledTasks(ctx: Context): ScheduledTask[] {
  const scopeKey = getScopeKeyFromContext(ctx);
  const currentProject = getCurrentProject(scopeKey);
  if (!currentProject || !ctx.chat) {
    return [];
  }

  return listScheduledTasks()
    .filter((task) => task.projectId === currentProject.id && task.delivery.chatId === ctx.chat!.id)
    .sort((left, right) => {
      const leftTimestamp = left.nextRunAt ? Date.parse(left.nextRunAt) : Number.MAX_SAFE_INTEGER;
      const rightTimestamp = right.nextRunAt
        ? Date.parse(right.nextRunAt)
        : Number.MAX_SAFE_INTEGER;
      return leftTimestamp - rightTimestamp;
    });
}

function formatTaskStatus(task: ScheduledTask): string {
  if (task.lastStatus === "error" && task.lastError) {
    return `${task.lastStatus}: ${task.lastError}`;
  }

  return task.lastStatus;
}

function buildTaskListText(tasks: ScheduledTask[]): string {
  const lines = tasks.map((task, index) => {
    const nextRunAt = task.nextRunAt ?? t("task.list.none");
    return [
      `${index + 1}. ${formatTaskListBadge(task)} - ${task.scheduleSummary}`,
      `   ${t("task.list.next_run", { value: nextRunAt })}`,
      `   ${t("task.list.status", { value: formatTaskStatus(task) })}`,
      `   ${t("task.list.prompt", { value: task.prompt })}`,
    ].join("\n");
  });

  return `${t("task.list.title")}\n\n${lines.join("\n\n")}`;
}

function buildTaskListKeyboard(tasks: ScheduledTask[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  tasks.forEach((task, index) => {
    keyboard
      .text(
        t("task.list.delete_button", { index: index + 1 }),
        `${TASKLIST_DELETE_CALLBACK_PREFIX}${task.id}`,
      )
      .row();
  });

  return keyboard;
}

export async function taskListCommand(ctx: CommandContext<Context>): Promise<void> {
  const tasks = getScopedScheduledTasks(ctx);

  if (tasks.length === 0) {
    await ctx.reply(t("task.list.empty"));
    return;
  }

  await replyWithInlineMenu(ctx, {
    menuKind: "tasklist",
    text: buildTaskListText(tasks),
    keyboard: buildTaskListKeyboard(tasks),
  });
}

export async function handleTaskListCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(TASKLIST_DELETE_CALLBACK_PREFIX)) {
    return false;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "tasklist");
  if (!isActiveMenu) {
    return true;
  }

  const taskId = data.slice(TASKLIST_DELETE_CALLBACK_PREFIX.length);

  try {
    const removed = await removeScheduledTask(taskId);
    await ctx.answerCallbackQuery({
      text: removed ? t("task.list.deleted") : t("task.list.delete_missing"),
    });

    const remainingTasks = getScopedScheduledTasks(ctx);
    if (remainingTasks.length === 0) {
      clearActiveInlineMenu("tasklist_empty_after_delete", getScopeKeyFromContext(ctx));
      await ctx.editMessageText(t("task.list.empty"));
      return true;
    }

    await ctx.editMessageText(buildTaskListText(remainingTasks), {
      reply_markup: appendInlineMenuCancelButton(buildTaskListKeyboard(remainingTasks), "tasklist"),
    });
  } catch (error) {
    logger.error("[TaskList] Failed to remove scheduled task", error);
    await ctx.answerCallbackQuery({ text: t("task.list.delete_error"), show_alert: true });
  }

  return true;
}
