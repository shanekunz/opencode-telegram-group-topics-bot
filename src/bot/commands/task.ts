import { randomUUID } from "node:crypto";
import type { CommandContext, Context } from "grammy";
import { getStoredAgent } from "../../agent/manager.js";
import { getStoredModel } from "../../model/manager.js";
import { getScopeFromContext, getScopeKeyFromContext } from "../scope.js";
import { CHAT_TYPE, TELEGRAM_CHAT_FIELD } from "../constants.js";
import { buildTopicThreadLink } from "../utils/topic-link.js";
import { t } from "../../i18n/index.js";
import { getCurrentProject } from "../../settings/manager.js";
import { interactionManager } from "../../interaction/manager.js";
import { taskCreationManager } from "../../scheduled-task/creation-manager.js";
import { parseTaskSchedule } from "../../scheduled-task/schedule-parser.js";
import {
  addScheduledTask,
  getScheduledTaskTopicByChatAndProject,
  upsertScheduledTaskTopic,
} from "../../scheduled-task/store.js";
import { SCHEDULED_TASK_OUTPUT_TOPIC_NAME } from "../../scheduled-task/topic-output.js";
import {
  createScheduledTaskModel,
  type ScheduledTask,
  type ScheduledTaskDeliveryTarget,
} from "../../scheduled-task/types.js";
import { TOPIC_COLORS } from "../../topic/colors.js";
import { logger } from "../../utils/logger.js";

function isForumGroupContext(ctx: Context): boolean {
  return (
    ctx.chat?.type === CHAT_TYPE.SUPERGROUP &&
    Reflect.get(ctx.chat, TELEGRAM_CHAT_FIELD.IS_FORUM) === true
  );
}

function buildScheduledTopicName(project: { name?: string; worktree: string }): string {
  void project;
  return SCHEDULED_TASK_OUTPUT_TOPIC_NAME;
}

async function resolveScheduledTaskDeliveryTarget(
  ctx: Context,
  project: { id: string; worktree: string; name?: string },
): Promise<{ delivery: ScheduledTaskDeliveryTarget; createdTopicLink: string | null }> {
  const scope = getScopeFromContext(ctx);
  if (!ctx.chat || !scope) {
    throw new Error("Missing chat scope for scheduled task delivery");
  }

  if (!isForumGroupContext(ctx)) {
    return {
      delivery: {
        chatId: ctx.chat.id,
        threadId: scope.threadId,
      },
      createdTopicLink: null,
    };
  }

  const topicName = buildScheduledTopicName(project);
  const existingTopic = await getScheduledTaskTopicByChatAndProject(ctx.chat.id, project.id);
  if (existingTopic) {
    if (existingTopic.topicName !== topicName) {
      const timestamp = new Date().toISOString();
      try {
        await ctx.api.editForumTopic(existingTopic.chatId, existingTopic.threadId, {
          name: topicName,
        });
        await upsertScheduledTaskTopic({
          ...existingTopic,
          topicName,
          updatedAt: timestamp,
        });
      } catch (error) {
        logger.warn("[TaskCommand] Failed to rename existing scheduled output topic", {
          chatId: existingTopic.chatId,
          threadId: existingTopic.threadId,
          error,
        });
      }
    }

    return {
      delivery: {
        chatId: existingTopic.chatId,
        threadId: existingTopic.threadId,
      },
      createdTopicLink: null,
    };
  }

  const createdTopic = await ctx.api.createForumTopic(ctx.chat.id, topicName, {
    icon_color: TOPIC_COLORS.BLUE,
  });

  const timestamp = new Date().toISOString();
  await upsertScheduledTaskTopic({
    chatId: ctx.chat.id,
    projectId: project.id,
    projectWorktree: project.worktree,
    threadId: createdTopic.message_thread_id,
    topicName,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return {
    delivery: {
      chatId: ctx.chat.id,
      threadId: createdTopic.message_thread_id,
    },
    createdTopicLink: buildTopicThreadLink(ctx.chat, createdTopic.message_thread_id),
  };
}

function getTaskScopeKey(ctx: Context): string {
  return getScopeKeyFromContext(ctx);
}

export async function taskCommand(ctx: CommandContext<Context>): Promise<void> {
  const scope = getScopeFromContext(ctx);
  const scopeKey = getTaskScopeKey(ctx);
  const currentProject = getCurrentProject(scopeKey);

  if (!currentProject) {
    await ctx.reply(t("task.project_not_selected"));
    return;
  }

  const storedModel = getStoredModel(scopeKey);
  const storedAgent = getStoredAgent(scopeKey);

  taskCreationManager.start(
    currentProject.id,
    currentProject.worktree,
    scopeKey,
    storedAgent,
    createScheduledTaskModel(storedModel),
    scopeKey,
  );

  interactionManager.start(
    {
      kind: "task",
      expectedInput: "text",
      metadata: { stage: "schedule" },
    },
    scopeKey,
  );

  const message = await ctx.reply(t("task.schedule_prompt"));
  taskCreationManager.setScheduleRequestMessageId(message.message_id, scopeKey);

  if (scope?.threadId !== null) {
    logger.info(`[TaskCommand] Started scheduled task flow in scope ${scopeKey}`);
  }
}

export async function handleTaskTextAnswer(ctx: Context): Promise<boolean> {
  const scopeKey = getTaskScopeKey(ctx);
  const text = ctx.message?.text?.trim();

  if (!taskCreationManager.isActive(scopeKey) || !text || text.startsWith("/")) {
    return false;
  }

  const interactionState = interactionManager.getSnapshot(scopeKey);
  if (interactionState?.kind !== "task") {
    taskCreationManager.clear(scopeKey);
    return false;
  }

  if (taskCreationManager.isParsingSchedule(scopeKey)) {
    await ctx.reply(t("task.schedule_parsing"));
    return true;
  }

  const creationState = taskCreationManager.getState(scopeKey);
  if (!creationState) {
    return false;
  }

  if (taskCreationManager.isWaitingForSchedule(scopeKey)) {
    taskCreationManager.markScheduleParsing(scopeKey);

    try {
      const parsedSchedule = await parseTaskSchedule(text, creationState.projectWorktree);
      const previewMessage = await ctx.reply(
        t("task.schedule_preview", {
          summary: parsedSchedule.summary,
          nextRunAt: parsedSchedule.nextRunAt,
        }),
      );

      taskCreationManager.setParsedSchedule(
        text,
        parsedSchedule,
        previewMessage.message_id,
        scopeKey,
      );
      interactionManager.transition(
        {
          kind: "task",
          expectedInput: "text",
          metadata: { stage: "prompt" },
        },
        scopeKey,
      );

      const promptMessage = await ctx.reply(t("task.prompt_prompt"));
      taskCreationManager.setPromptRequestMessageId(promptMessage.message_id, scopeKey);
      return true;
    } catch (error) {
      logger.warn("[TaskCommand] Failed to parse schedule", { scopeKey, error });
      taskCreationManager.resetSchedule(scopeKey);
      await ctx.reply(
        t("task.schedule_error", {
          message: error instanceof Error ? error.message : t("common.unknown_error"),
        }),
      );
      return true;
    }
  }

  if (!taskCreationManager.isWaitingForPrompt(scopeKey) || !creationState.parsedSchedule) {
    return false;
  }

  try {
    const currentProject = getCurrentProject(scopeKey);
    if (!currentProject || !ctx.chat) {
      await ctx.reply(t("task.project_not_selected"));
      return true;
    }

    const { delivery, createdTopicLink } = await resolveScheduledTaskDeliveryTarget(
      ctx,
      currentProject,
    );
    const task: ScheduledTask =
      creationState.parsedSchedule.kind === "cron"
        ? {
            id: randomUUID(),
            kind: "cron",
            projectId: creationState.projectId,
            projectWorktree: creationState.projectWorktree,
            createdFromScopeKey: creationState.createdFromScopeKey,
            agent: creationState.agent,
            model: creationState.model,
            delivery,
            scheduleText: creationState.scheduleText ?? creationState.parsedSchedule.summary,
            scheduleSummary: creationState.parsedSchedule.summary,
            timezone: creationState.parsedSchedule.timezone,
            prompt: text,
            createdAt: new Date().toISOString(),
            nextRunAt: creationState.parsedSchedule.nextRunAt,
            lastRunAt: null,
            runCount: 0,
            lastStatus: "idle",
            lastError: null,
            cron: creationState.parsedSchedule.cron,
          }
        : {
            id: randomUUID(),
            kind: "once",
            projectId: creationState.projectId,
            projectWorktree: creationState.projectWorktree,
            createdFromScopeKey: creationState.createdFromScopeKey,
            agent: creationState.agent,
            model: creationState.model,
            delivery,
            scheduleText: creationState.scheduleText ?? creationState.parsedSchedule.summary,
            scheduleSummary: creationState.parsedSchedule.summary,
            timezone: creationState.parsedSchedule.timezone,
            prompt: text,
            createdAt: new Date().toISOString(),
            nextRunAt: creationState.parsedSchedule.nextRunAt,
            lastRunAt: null,
            runCount: 0,
            lastStatus: "idle",
            lastError: null,
            runAt: creationState.parsedSchedule.runAt,
          };

    await addScheduledTask(task);

    const createdTopicLine = createdTopicLink
      ? `\n\n${t("task.created_topic_link", { url: createdTopicLink })}`
      : "";

    await ctx.reply(
      `${t("task.created", {
        summary: task.scheduleSummary,
        nextRunAt: task.nextRunAt ?? t("common.unknown"),
      })}${createdTopicLine}`,
    );
  } catch (error) {
    logger.error("[TaskCommand] Failed to create scheduled task", error);
    await ctx.reply(t("task.create_error"));
  } finally {
    taskCreationManager.clear(scopeKey);
    interactionManager.clear("task_completed", scopeKey);
  }

  return true;
}
