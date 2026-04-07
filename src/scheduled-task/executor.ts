import { opencodeClient } from "../opencode/client.js";
import { logger } from "../utils/logger.js";
import type { ScheduledTask, ScheduledTaskExecutionResult } from "./types.js";

const SCHEDULED_TASK_AGENT = "build";
const SCHEDULED_TASK_SESSION_TITLE = "Scheduled task run";
const SCHEDULED_TASK_PERMISSION_RULESET = [
  { permission: "*", pattern: "*", action: "allow" as const },
  { permission: "question", pattern: "*", action: "deny" as const },
];

function collectResponseText(
  parts: Array<{ type?: string; text?: string; ignored?: boolean }>,
): string {
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string" && !part.ignored)
    .map((part) => part.text)
    .join("")
    .trim();
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    typeof error.data === "object" &&
    error.data !== null &&
    "message" in error.data &&
    typeof error.data.message === "string" &&
    error.data.message.trim()
  ) {
    return error.data.message.trim();
  }

  return "Unknown scheduled task execution error";
}

function toErrorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause:
        error.cause && typeof error.cause === "object"
          ? JSON.parse(JSON.stringify(error.cause))
          : error.cause,
    };
  }

  if (typeof error === "object" && error !== null) {
    try {
      return JSON.parse(JSON.stringify(error)) as Record<string, unknown>;
    } catch {
      return { value: String(error) };
    }
  }

  return { value: error };
}

export async function executeScheduledTask(
  task: ScheduledTask,
): Promise<ScheduledTaskExecutionResult> {
  const startedAt = new Date().toISOString();
  let sessionId: string | null = null;

  try {
    const { data: session, error: createError } = await opencodeClient.session.create({
      directory: task.projectWorktree,
      title: SCHEDULED_TASK_SESSION_TITLE,
      permission: SCHEDULED_TASK_PERMISSION_RULESET,
    });

    if (createError || !session) {
      throw createError || new Error("Failed to create temporary scheduled task session");
    }

    sessionId = session.id;

    logger.info(
      `[ScheduledTaskExecutor] Created temporary session: taskId=${task.id}, sessionId=${sessionId}`,
    );

    const promptOptions: {
      sessionID: string;
      directory: string;
      parts: Array<{ type: "text"; text: string }>;
      agent: string;
      model?: { providerID: string; modelID: string; options?: { timeout: false } };
      variant?: string;
    } = {
      sessionID: session.id,
      directory: session.directory,
      parts: [{ type: "text", text: task.prompt }],
      agent: task.agent ?? SCHEDULED_TASK_AGENT,
    };

    if (task.model.providerID && task.model.modelID) {
      promptOptions.model = {
        providerID: task.model.providerID,
        modelID: task.model.modelID,
        options: { timeout: false },
      };
    }

    if (task.model.variant) {
      promptOptions.variant = task.model.variant;
    }

    logger.info(
      `[ScheduledTaskExecutor] Starting prompt execution: taskId=${task.id}, sessionId=${sessionId}`,
    );

    const { data: response, error: promptError } = await opencodeClient.session.prompt(
      promptOptions as never,
    );

    if (promptError || !response) {
      throw promptError || new Error("Scheduled task prompt execution failed");
    }

    const resultText = collectResponseText(response.parts);
    if (!resultText) {
      throw new Error("Scheduled task returned an empty assistant response");
    }

    logger.info(
      `[ScheduledTaskExecutor] Prompt execution completed: taskId=${task.id}, sessionId=${sessionId}`,
    );

    return {
      taskId: task.id,
      status: "success",
      startedAt,
      finishedAt: new Date().toISOString(),
      resultText,
      errorMessage: null,
    };
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    logger.warn(
      `[ScheduledTaskExecutor] Task execution failed: id=${task.id}, message=${errorMessage}`,
      toErrorDetails(error),
    );

    return {
      taskId: task.id,
      status: "error",
      startedAt,
      finishedAt: new Date().toISOString(),
      resultText: null,
      errorMessage,
    };
  } finally {
    if (sessionId) {
      try {
        logger.info(
          `[ScheduledTaskExecutor] Deleting temporary session: taskId=${task.id}, sessionId=${sessionId}`,
        );
        await opencodeClient.session.delete({ sessionID: sessionId });
      } catch (error) {
        logger.warn(
          `[ScheduledTaskExecutor] Failed to delete temporary session: sessionId=${sessionId}`,
          toErrorDetails(error),
          error,
        );
      }
    }
  }
}
