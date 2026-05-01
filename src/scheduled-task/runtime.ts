import type { Bot, Context } from "grammy";
import { formatAssistantRunFooter } from "../bot/utils/assistant-run-footer.js";
import { config } from "../config.js";
import { getThreadSendOptions } from "../bot/scope.js";
import { sendBotText } from "../bot/utils/telegram-text.js";
import { logger } from "../utils/logger.js";
import { executeScheduledTask, SCHEDULED_TASK_AGENT } from "./executor.js";
import {
  getScheduledTask,
  listScheduledTasks,
  removeScheduledTask,
  updateScheduledTask,
} from "./store.js";
import type { ScheduledTask } from "./types.js";

const TELEGRAM_MESSAGE_MAX_LENGTH = 4000;
const DEFAULT_POLL_INTERVAL_MS = Math.max(5, config.bot.scheduledTasksPollIntervalSec) * 1000;

interface CronFieldMatcher {
  matches: (value: number) => boolean;
}

interface ZonedDateParts {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
}

interface ScheduledTaskDeliveryMessage {
  bodyText: string;
  footerText?: string;
}

const zonedPartsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getZonedPartsFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = zonedPartsFormatterCache.get(timezone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    minute: "2-digit",
    hour: "2-digit",
    day: "2-digit",
    month: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });

  zonedPartsFormatterCache.set(timezone, formatter);
  return formatter;
}

function getDatePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

function getZonedDateParts(date: Date, timezone: string): ZonedDateParts | null {
  const parts = getZonedPartsFormatter(timezone).formatToParts(date);
  const minute = Number.parseInt(getDatePart(parts, "minute"), 10);
  const hour = Number.parseInt(getDatePart(parts, "hour"), 10);
  const dayOfMonth = Number.parseInt(getDatePart(parts, "day"), 10);
  const month = Number.parseInt(getDatePart(parts, "month"), 10);
  const weekdayToken = getDatePart(parts, "weekday").toLowerCase();
  const dayOfWeekMap: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };
  const dayOfWeek = dayOfWeekMap[weekdayToken];

  if (
    !Number.isInteger(minute) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(dayOfMonth) ||
    !Number.isInteger(month) ||
    dayOfWeek === undefined
  ) {
    return null;
  }

  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
  };
}

function tokenToNumber(token: string, aliases?: Record<string, number>): number | null {
  const normalized = token.trim().toLowerCase();
  if (aliases && normalized in aliases) {
    return aliases[normalized]!;
  }

  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  return Number.parseInt(normalized, 10);
}

function createCronFieldMatcher(
  field: string,
  min: number,
  max: number,
  aliases?: Record<string, number>,
): CronFieldMatcher {
  const values = new Set<number>();
  const segments = field
    .trim()
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    throw new Error(`Invalid cron field: ${field}`);
  }

  const addValue = (value: number): void => {
    if (value < min || value > max) {
      throw new Error(`Cron field value out of range: ${value}`);
    }

    values.add(value);
  };

  for (const segment of segments) {
    const [base, rawStep] = segment.split("/");
    const step = rawStep ? Number.parseInt(rawStep, 10) : 1;
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`Invalid cron step: ${segment}`);
    }

    if (base === "*") {
      for (let value = min; value <= max; value += step) {
        addValue(value);
      }
      continue;
    }

    if (base.includes("-")) {
      const [startToken, endToken] = base.split("-");
      const start = tokenToNumber(startToken, aliases);
      const end = tokenToNumber(endToken, aliases);

      if (start === null || end === null || start > end) {
        throw new Error(`Invalid cron range: ${segment}`);
      }

      for (let value = start; value <= end; value += step) {
        addValue(value);
      }
      continue;
    }

    const singleValue = tokenToNumber(base, aliases);
    if (singleValue === null) {
      throw new Error(`Invalid cron token: ${segment}`);
    }

    addValue(singleValue);
  }

  return {
    matches: (value) => values.has(value),
  };
}

function normalizeCronWeekdayValue(value: number): number {
  return value === 7 ? 0 : value;
}

function parseCronExpression(cron: string): {
  minute: CronFieldMatcher;
  hour: CronFieldMatcher;
  dayOfMonth: CronFieldMatcher;
  month: CronFieldMatcher;
  dayOfWeek: CronFieldMatcher;
} {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Unsupported cron expression: ${cron}`);
  }

  const monthAliases: Record<string, number> = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  const weekdayAliases: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };

  const [minuteField, hourField, dayOfMonthField, monthField, dayOfWeekField] = parts;
  const dayOfWeekMatcher = createCronFieldMatcher(dayOfWeekField, 0, 7, weekdayAliases);

  return {
    minute: createCronFieldMatcher(minuteField, 0, 59),
    hour: createCronFieldMatcher(hourField, 0, 23),
    dayOfMonth: createCronFieldMatcher(dayOfMonthField, 1, 31),
    month: createCronFieldMatcher(monthField, 1, 12, monthAliases),
    dayOfWeek: {
      matches: (value) => dayOfWeekMatcher.matches(normalizeCronWeekdayValue(value)),
    },
  };
}

function getNextCronRunAt(cron: string, timezone: string, afterIso: string): string | null {
  const matcher = parseCronExpression(cron);
  const afterDate = new Date(afterIso);
  if (Number.isNaN(afterDate.getTime())) {
    return null;
  }

  const nextMinute = Math.floor(afterDate.getTime() / 60000) * 60000 + 60000;
  const oneYearInMinutes = 366 * 24 * 60;

  for (let index = 0; index < oneYearInMinutes; index += 1) {
    const candidate = new Date(nextMinute + index * 60000);
    const zonedParts = getZonedDateParts(candidate, timezone);
    if (!zonedParts) {
      continue;
    }

    if (
      matcher.minute.matches(zonedParts.minute) &&
      matcher.hour.matches(zonedParts.hour) &&
      matcher.dayOfMonth.matches(zonedParts.dayOfMonth) &&
      matcher.month.matches(zonedParts.month) &&
      matcher.dayOfWeek.matches(zonedParts.dayOfWeek)
    ) {
      return candidate.toISOString();
    }
  }

  return null;
}

function splitMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MESSAGE_MAX_LENGTH) {
    return [text];
  }

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > TELEGRAM_MESSAGE_MAX_LENGTH) {
    let splitIndex = remaining.lastIndexOf("\n\n", TELEGRAM_MESSAGE_MAX_LENGTH);
    if (splitIndex < 0) {
      splitIndex = remaining.lastIndexOf("\n", TELEGRAM_MESSAGE_MAX_LENGTH);
    }
    if (splitIndex < 0) {
      splitIndex = TELEGRAM_MESSAGE_MAX_LENGTH;
    }

    parts.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining) {
    parts.push(remaining);
  }

  return parts;
}

function buildSuccessMessage(
  task: ScheduledTask,
  startedAt: string,
  finishedAt: string,
  resultText: string,
): ScheduledTaskDeliveryMessage {
  return {
    bodyText: [
      "Scheduled task completed",
      `Project: ${task.projectWorktree}`,
      `Schedule: ${task.scheduleSummary}`,
      `Finished: ${finishedAt}`,
      "",
      `Prompt:\n${task.prompt}`,
      "",
      `Result:\n${resultText}`,
    ].join("\n"),
    footerText: formatAssistantRunFooter(
      {
        sessionId: task.id,
        startedAt: Date.parse(startedAt),
        configuredAgent: task.agent ?? SCHEDULED_TASK_AGENT,
        configuredProviderID: task.model.providerID,
        configuredModelID: task.model.modelID,
      },
      Date.parse(finishedAt),
    ),
  };
}

function buildErrorMessage(
  task: ScheduledTask,
  finishedAt: string,
  errorMessage: string,
): ScheduledTaskDeliveryMessage {
  return {
    bodyText: [
      "Scheduled task failed",
      `Project: ${task.projectWorktree}`,
      `Schedule: ${task.scheduleSummary}`,
      `Finished: ${finishedAt}`,
      "",
      `Prompt:\n${task.prompt}`,
      "",
      `Error:\n${errorMessage}`,
    ].join("\n"),
  };
}

async function deliverResult(
  bot: Bot<Context>,
  task: ScheduledTask,
  message: ScheduledTaskDeliveryMessage,
): Promise<void> {
  const parts = splitMessage(message.bodyText);
  const suppressBodyNotification = Boolean(message.footerText);

  logger.info(
    `[ScheduledTaskRuntime] Delivering scheduled task result: taskId=${task.id}, chatId=${task.delivery.chatId}, threadId=${task.delivery.threadId ?? "none"}, parts=${parts.length}`,
  );

  for (const part of parts) {
    await sendBotText({
      api: bot.api,
      chatId: task.delivery.chatId,
      text: part,
      options: {
        ...getThreadSendOptions(task.delivery.threadId),
        ...(suppressBodyNotification ? { disable_notification: true } : {}),
      },
      format: "raw",
    });
  }

  if (message.footerText) {
    await sendBotText({
      api: bot.api,
      chatId: task.delivery.chatId,
      text: message.footerText,
      options: getThreadSendOptions(task.delivery.threadId),
      format: "raw",
    });
  }
}

async function finalizeTaskRun(bot: Bot<Context>, task: ScheduledTask): Promise<void> {
  const currentTask = getScheduledTask(task.id);
  if (!currentTask) {
    return;
  }

  logger.info(`[ScheduledTaskRuntime] Finalizing scheduled task: taskId=${task.id}`);

  try {
    const execution = await executeScheduledTask(currentTask);
    const nextRunAt =
      currentTask.kind === "cron"
        ? getNextCronRunAt(currentTask.cron, currentTask.timezone, execution.startedAt)
        : null;

    const updatedTask = await updateScheduledTask(currentTask.id, (existingTask) => ({
      ...existingTask,
      lastRunAt: execution.finishedAt,
      nextRunAt,
      runCount: existingTask.runCount + 1,
      lastStatus: execution.status,
      lastError: execution.errorMessage,
    }));

    if (!updatedTask) {
      return;
    }

    logger.info(
      `[ScheduledTaskRuntime] Scheduled task execution persisted: taskId=${task.id}, status=${execution.status}`,
    );

    const message =
      execution.status === "success"
        ? buildSuccessMessage(
            updatedTask,
            execution.startedAt,
            execution.finishedAt,
            execution.resultText ?? "",
          )
        : buildErrorMessage(
            updatedTask,
            execution.finishedAt,
            execution.errorMessage ?? "Unknown scheduled task execution error",
          );

    await deliverResult(bot, updatedTask, message);
    logger.info(`[ScheduledTaskRuntime] Scheduled task delivery completed: taskId=${task.id}`);

    if (updatedTask.kind === "once" && updatedTask.nextRunAt === null) {
      await removeScheduledTask(updatedTask.id);
    }
  } catch (error) {
    const fallbackFinishedAt = new Date().toISOString();
    const fallbackErrorMessage =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "Scheduled task finalization failed";

    await updateScheduledTask(task.id, (existingTask) => ({
      ...existingTask,
      lastRunAt: existingTask.lastRunAt ?? fallbackFinishedAt,
      nextRunAt:
        existingTask.kind === "cron"
          ? (existingTask.nextRunAt ??
            getNextCronRunAt(existingTask.cron, existingTask.timezone, fallbackFinishedAt))
          : null,
      runCount:
        existingTask.lastStatus === "running" ? existingTask.runCount + 1 : existingTask.runCount,
      lastStatus: "error",
      lastError: fallbackErrorMessage,
    }));

    logger.error(
      "[ScheduledTaskRuntime] Scheduled task finalization failed",
      { taskId: task.id, errorMessage: fallbackErrorMessage },
      error,
    );
  }
}

export interface ScheduledTaskRuntime {
  start: () => void;
  stop: () => void;
  runDueTasks: () => Promise<void>;
}

export function createScheduledTaskRuntime(bot: Bot<Context>): ScheduledTaskRuntime {
  const runningTaskIds = new Set<string>();
  let timer: NodeJS.Timeout | null = null;

  const recoverStaleRunningTasks = async (): Promise<void> => {
    const staleTasks = listScheduledTasks().filter(
      (task) => task.lastStatus === "running" && !runningTaskIds.has(task.id),
    );

    if (staleTasks.length === 0) {
      return;
    }

    await Promise.all(
      staleTasks.map((task) =>
        updateScheduledTask(task.id, (existingTask) => ({
          ...existingTask,
          lastStatus: "error",
          lastError: "Recovered stale scheduled task state after bot restart",
        })),
      ),
    );

    logger.warn(
      `[ScheduledTaskRuntime] Recovered stale running tasks: ${staleTasks.map((task) => task.id).join(", ")}`,
    );
  };

  const runDueTasks = async (): Promise<void> => {
    await recoverStaleRunningTasks();

    const now = Date.now();
    const tasks = listScheduledTasks();
    const executions: Promise<void>[] = [];

    for (const task of tasks) {
      if (!task.nextRunAt || task.lastStatus === "running" || runningTaskIds.has(task.id)) {
        continue;
      }

      const nextRunTimestamp = Date.parse(task.nextRunAt);
      if (Number.isNaN(nextRunTimestamp) || nextRunTimestamp > now) {
        continue;
      }

      runningTaskIds.add(task.id);

      executions.push(
        updateScheduledTask(task.id, (existingTask) => ({
          ...existingTask,
          lastStatus: "running",
          lastError: null,
        }))
          .then(async (updatedTask) => {
            if (!updatedTask) {
              return;
            }

            await finalizeTaskRun(bot, updatedTask);
          })
          .catch((error) => {
            logger.error("[ScheduledTaskRuntime] Failed to execute scheduled task", {
              taskId: task.id,
              error,
            });
          })
          .finally(() => {
            runningTaskIds.delete(task.id);
          }),
      );
    }

    await Promise.all(executions);
  };

  return {
    start: () => {
      if (timer) {
        return;
      }

      timer = setInterval(() => {
        void runDueTasks();
      }, DEFAULT_POLL_INTERVAL_MS);

      void runDueTasks();
      logger.info(
        `[ScheduledTaskRuntime] Started with poll interval ${config.bot.scheduledTasksPollIntervalSec}s`,
      );
    },
    stop: () => {
      if (!timer) {
        return;
      }

      clearInterval(timer);
      timer = null;
      runningTaskIds.clear();
    },
    runDueTasks,
  };
}

export function __getNextCronRunAtForTests(
  cron: string,
  timezone: string,
  afterIso: string,
): string | null {
  return getNextCronRunAt(cron, timezone, afterIso);
}
