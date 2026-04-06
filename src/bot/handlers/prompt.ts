import { Bot, Context } from "grammy";
import type { FilePartInput, TextPartInput } from "@opencode-ai/sdk/v2";
import { opencodeClient } from "../../opencode/client.js";
import { classifyPromptSubmitError } from "../../opencode/prompt-submit-error.js";
import { clearSession, getCurrentSession, setCurrentSession } from "../../session/manager.js";
import { ingestSessionInfoForCache } from "../../session/cache-manager.js";
import { getCurrentProject } from "../../settings/manager.js";
import { isTtsEnabled } from "../../settings/manager.js";
import { getStoredAgent, resolveProjectAgent } from "../../agent/manager.js";
import { getStoredModel } from "../../model/manager.js";
import { formatVariantForButton } from "../../variant/manager.js";
import { createMainKeyboard } from "../utils/keyboard.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { summaryAggregator } from "../../summary/aggregator.js";
import { interactionManager } from "../../interaction/manager.js";
import { clearAllInteractionState } from "../../interaction/cleanup.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { formatErrorDetails } from "../../utils/error-format.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import {
  GLOBAL_SCOPE_KEY,
  SCOPE_CONTEXT,
  getScopeFromContext,
  getThreadSendOptions,
} from "../scope.js";
import { BOT_I18N_KEY, CHAT_TYPE } from "../constants.js";
import { INTERACTION_CLEAR_REASON } from "../../interaction/constants.js";
import { getTopicBindingByScopeKey } from "../../topic/manager.js";
import { getScheduledTaskTopicByChatAndThread } from "../../scheduled-task/store.js";

/** Module-level references for async callbacks that don't have ctx. */
let botInstance: Bot<Context> | null = null;
let chatIdInstance: number | null = null;

type PromptRequestOptions = {
  sessionID: string;
  directory: string;
  parts: Array<TextPartInput | FilePartInput>;
  model?: { providerID: string; modelID: string };
  agent?: string;
  variant?: string;
};

export type PromptResponseMode = "text_only" | "text_and_tts";

type ProcessPromptOptions = {
  responseMode?: PromptResponseMode;
};

type PromptErrorLogContext = {
  sessionId: string;
  directory: string;
  agent: string;
  modelProvider: string;
  modelId: string;
  variant: string;
  promptLength: number;
  fileCount: number;
};

interface QueuedPromptRequest {
  sessionId: string;
  chatId: number;
  threadId: number | null;
  responseMode: PromptResponseMode;
  promptOptions: PromptRequestOptions;
  promptErrorLogContext: PromptErrorLogContext;
  notifyOnQueue: boolean;
}

const queuedPromptRequests = new Map<string, QueuedPromptRequest[]>();
const drainingQueuedSessions = new Set<string>();
const activePromptResponseModes = new Map<string, PromptResponseMode>();

// If OpenCode headless/server mode gains a native per-session queue later, prefer that
// over this bot-side queue so Telegram matches the upstream client behavior more closely.
const QUEUED_PROMPT_PREVIEW_MAX_LENGTH = 280;

export function getPromptBotInstance(): Bot<Context> | null {
  return botInstance;
}

export function getPromptChatId(): number | null {
  return chatIdInstance;
}

function getQueuedPromptCount(sessionId: string): number {
  return queuedPromptRequests.get(sessionId)?.length ?? 0;
}

function enqueuePromptRequest(request: QueuedPromptRequest): number {
  const queue = queuedPromptRequests.get(request.sessionId) ?? [];
  queue.push(request);
  queuedPromptRequests.set(request.sessionId, queue);
  return queue.length;
}

function takeNextQueuedPromptRequest(sessionId: string): QueuedPromptRequest | null {
  const queue = queuedPromptRequests.get(sessionId);
  if (!queue || queue.length === 0) {
    return null;
  }

  const nextRequest = queue.shift() ?? null;
  if (queue.length === 0) {
    queuedPromptRequests.delete(sessionId);
  } else {
    queuedPromptRequests.set(sessionId, queue);
  }

  return nextRequest;
}

async function sendQueuedPromptNotice(
  bot: Bot<Context>,
  chatId: number,
  threadId: number | null,
  position: number,
): Promise<void> {
  await bot.api
    .sendMessage(chatId, t("bot.session_queued", { position: String(position) }), {
      ...getThreadSendOptions(threadId),
    })
    .catch(() => {});
}

function truncateQueuedPromptPreview(text: string): string {
  if (text.length <= QUEUED_PROMPT_PREVIEW_MAX_LENGTH) {
    return text;
  }

  return `${text.slice(0, QUEUED_PROMPT_PREVIEW_MAX_LENGTH - 3).trimEnd()}...`;
}

function getQueuedPromptPreview(request: QueuedPromptRequest): string {
  const textParts = request.promptOptions.parts
    .filter((part): part is TextPartInput => part.type === "text")
    .map((part) => part.text.trim())
    .filter((text) => text.length > 0);

  const firstText = textParts[0] ?? "See attached file";
  return truncateQueuedPromptPreview(firstText);
}

async function sendQueuedPromptStartedNotice(
  bot: Bot<Context>,
  request: QueuedPromptRequest,
): Promise<void> {
  await bot.api
    .sendMessage(
      request.chatId,
      t("bot.session_queue_started", {
        preview: getQueuedPromptPreview(request),
      }),
      {
        ...getThreadSendOptions(request.threadId),
      },
    )
    .catch(() => {});
}

function buildPromptRequest(
  currentSession: { id: string; directory: string },
  currentAgent: string | null,
  storedModel: { providerID?: string | null; modelID?: string | null; variant?: string | null },
  text: string,
  fileParts: FilePartInput[],
): { promptOptions: PromptRequestOptions; promptErrorLogContext: PromptErrorLogContext } {
  const parts: Array<TextPartInput | FilePartInput> = [];

  if (text.trim().length > 0) {
    parts.push({ type: "text", text });
  }

  parts.push(...fileParts);

  if (parts.length === 0 || (parts.length > 0 && parts.every((part) => part.type === "file"))) {
    if (fileParts.length > 0) {
      parts.unshift({ type: "text", text: "See attached file" });
    }
  }

  const promptOptions: PromptRequestOptions = {
    sessionID: currentSession.id,
    directory: currentSession.directory,
    parts,
    agent: currentAgent ?? undefined,
  };

  if (storedModel.providerID && storedModel.modelID) {
    promptOptions.model = {
      providerID: storedModel.providerID,
      modelID: storedModel.modelID,
    };

    if (storedModel.variant) {
      promptOptions.variant = storedModel.variant;
    }
  }

  return {
    promptOptions,
    promptErrorLogContext: {
      sessionId: currentSession.id,
      directory: currentSession.directory,
      agent: currentAgent || "default",
      modelProvider: storedModel.providerID || "default",
      modelId: storedModel.modelID || "default",
      variant: storedModel.variant || "default",
      promptLength: text.length,
      fileCount: fileParts.length,
    },
  };
}

function setActivePromptResponseMode(sessionId: string, responseMode: PromptResponseMode): void {
  activePromptResponseModes.set(sessionId, responseMode);
}

export function getDefaultPromptResponseMode(): PromptResponseMode {
  return isTtsEnabled() ? "text_and_tts" : "text_only";
}

export function activatePromptResponseMode(
  sessionId: string,
  responseMode: PromptResponseMode,
): void {
  setActivePromptResponseMode(sessionId, responseMode);
}

export function clearPromptResponseMode(sessionId: string): void {
  activePromptResponseModes.delete(sessionId);
}

export function consumePromptResponseMode(sessionId: string): PromptResponseMode | null {
  const responseMode = activePromptResponseModes.get(sessionId) ?? null;
  activePromptResponseModes.delete(sessionId);
  return responseMode;
}

function submitPromptRequest(bot: Bot<Context>, request: QueuedPromptRequest): void {
  setActivePromptResponseMode(request.sessionId, request.responseMode);

  logger.info(
    `[Bot] Calling session.promptAsync (fire-and-forget) with agent=${request.promptOptions.agent}, fileCount=${request.promptErrorLogContext.fileCount}...`,
  );

  safeBackgroundTask({
    taskName: "session.promptAsync",
    task: () => opencodeClient.session.promptAsync(request.promptOptions),
    onSuccess: ({ error }) => {
      if (error) {
        const details = formatErrorDetails(error, 6000);
        const errorType = classifyPromptSubmitError(error);
        logger.error(
          "[Bot] OpenCode API returned an error for session.promptAsync",
          request.promptErrorLogContext,
        );
        logger.error("[Bot] session.promptAsync error details:", details);
        logger.error("[Bot] session.promptAsync raw API error object:", error);

        if (errorType === "busy") {
          const position = enqueuePromptRequest({
            ...request,
            notifyOnQueue: false,
          });
          if (request.notifyOnQueue) {
            void sendQueuedPromptNotice(bot, request.chatId, request.threadId, position);
          }
          return;
        }

        const errorMessageKey =
          errorType === "session_not_found"
            ? "bot.prompt_send_error_session_not_found"
            : "bot.prompt_send_error";

        void bot.api
          .sendMessage(request.chatId, t(errorMessageKey), {
            ...getThreadSendOptions(request.threadId),
          })
          .catch(() => {});
        return;
      }

      logger.info("[Bot] session.promptAsync accepted");
    },
    onError: (error) => {
      const details = formatErrorDetails(error, 6000);
      const errorType = classifyPromptSubmitError(error);
      logger.error(
        "[Bot] session.promptAsync background task failed",
        request.promptErrorLogContext,
      );
      logger.error("[Bot] session.promptAsync background failure details:", details);
      logger.error("[Bot] session.promptAsync raw background error object:", error);

      if (errorType === "busy") {
        clearPromptResponseMode(request.sessionId);
        const position = enqueuePromptRequest({
          ...request,
          notifyOnQueue: false,
        });
        if (request.notifyOnQueue) {
          void sendQueuedPromptNotice(bot, request.chatId, request.threadId, position);
        }
        return;
      }

      const errorMessageKey =
        errorType === "session_not_found"
          ? "bot.prompt_send_error_session_not_found"
          : "bot.prompt_send_error";

      clearPromptResponseMode(request.sessionId);

      void bot.api
        .sendMessage(request.chatId, t(errorMessageKey), {
          ...getThreadSendOptions(request.threadId),
        })
        .catch(() => {});
    },
  });
}

export async function dispatchNextQueuedPrompt(sessionId: string): Promise<boolean> {
  if (
    !botInstance ||
    drainingQueuedSessions.has(sessionId) ||
    getQueuedPromptCount(sessionId) === 0
  ) {
    return false;
  }

  const nextRequest = takeNextQueuedPromptRequest(sessionId);
  if (!nextRequest) {
    return false;
  }

  drainingQueuedSessions.add(sessionId);
  try {
    const sessionBusy = await isSessionBusy(sessionId, nextRequest.promptOptions.directory);
    if (sessionBusy) {
      enqueuePromptRequest(nextRequest);
      return false;
    }

    await sendQueuedPromptStartedNotice(botInstance, nextRequest);
    submitPromptRequest(botInstance, {
      ...nextRequest,
      notifyOnQueue: false,
    });
    return true;
  } finally {
    drainingQueuedSessions.delete(sessionId);
  }
}

export function __resetQueuedPromptsForTests(): void {
  queuedPromptRequests.clear();
  drainingQueuedSessions.clear();
  activePromptResponseModes.clear();
}

async function isSessionBusy(sessionId: string, directory: string): Promise<boolean> {
  try {
    const { data, error } = await opencodeClient.session.status({ directory });

    if (error || !data) {
      logger.warn("[Bot] Failed to check session status before prompt:", error);
      return false;
    }

    const sessionStatus = (data as Record<string, { type?: string }>)[sessionId];
    if (!sessionStatus) {
      return false;
    }

    logger.debug(`[Bot] Current session status before prompt: ${sessionStatus.type || "unknown"}`);
    return sessionStatus.type === "busy";
  } catch (err) {
    logger.warn("[Bot] Error checking session status before prompt:", err);
    return false;
  }
}

function resetMismatchedSessionContextForScope(scopeKey: string): void {
  clearAllInteractionState(INTERACTION_CLEAR_REASON.SESSION_MISMATCH_RESET, scopeKey);
  clearSession(scopeKey);
}

export interface ProcessPromptDeps {
  bot: Bot<Context>;
  ensureEventSubscription: (directory: string) => Promise<void>;
}

/**
 * Processes a user prompt: ensures project/session, subscribes to events, and sends
 * the prompt to OpenCode. Used by text, voice, and photo message handlers.
 *
 * @param ctx - Grammy context
 * @param text - Text content of the prompt
 * @param deps - Dependencies (bot and event subscription)
 * @param fileParts - Optional file parts (for photo/document attachments)
 * @returns true if the prompt was dispatched, false if it was blocked/failed early.
 */
export async function processUserPrompt(
  ctx: Context,
  text: string,
  deps: ProcessPromptDeps,
  fileParts: FilePartInput[] = [],
  options: ProcessPromptOptions = {},
): Promise<boolean> {
  const { bot, ensureEventSubscription } = deps;
  const scope = getScopeFromContext(ctx);
  const responseMode = options.responseMode ?? getDefaultPromptResponseMode();
  const scopeKey = scope?.key ?? GLOBAL_SCOPE_KEY;
  const usePinned = ctx.chat?.type !== CHAT_TYPE.PRIVATE;

  if (
    scope?.context === SCOPE_CONTEXT.GROUP_TOPIC &&
    ctx.chat &&
    typeof scope.threadId === "number" &&
    (await getScheduledTaskTopicByChatAndThread(ctx.chat.id, scope.threadId))
  ) {
    await ctx.reply(t("task.output_topic_blocked"), getThreadSendOptions(scope.threadId));
    return false;
  }

  const currentProject = getCurrentProject(scopeKey);
  if (!currentProject) {
    await ctx.reply(t("bot.project_not_selected"));
    return false;
  }

  botInstance = bot;
  chatIdInstance = ctx.chat!.id;

  // Initialize pinned message manager if not already
  if (usePinned && !pinnedMessageManager.isInitialized(scopeKey)) {
    pinnedMessageManager.initialize(bot.api, ctx.chat!.id, scopeKey, scope?.threadId ?? null);
  }

  // Initialize keyboard manager if not already
  keyboardManager.initialize(bot.api, ctx.chat!.id, scopeKey);

  let currentSession = getCurrentSession(scopeKey);

  if (scope?.context === SCOPE_CONTEXT.GROUP_TOPIC && !getTopicBindingByScopeKey(scopeKey)) {
    await ctx.reply(t(BOT_I18N_KEY.TOPIC_UNBOUND), getThreadSendOptions(scope.threadId));
    return false;
  }

  if (currentSession && currentSession.directory !== currentProject.worktree) {
    logger.warn(
      `[Bot] Session/project mismatch detected. sessionDirectory=${currentSession.directory}, projectDirectory=${currentProject.worktree}. Resetting session context.`,
    );
    resetMismatchedSessionContextForScope(scopeKey);
    await ctx.reply(t("bot.session_reset_project_mismatch"));
    return false;
  }

  if (!currentSession) {
    if (scope?.context === SCOPE_CONTEXT.GROUP_TOPIC) {
      await ctx.reply(t(BOT_I18N_KEY.TOPIC_UNBOUND), getThreadSendOptions(scope.threadId));
      return false;
    }

    await ctx.reply(t("bot.creating_session"));

    const { data: session, error } = await opencodeClient.session.create({
      directory: currentProject.worktree,
    });

    if (error || !session) {
      await ctx.reply(t("bot.create_session_error"));
      return false;
    }

    logger.info(
      `[Bot] Created new session: id=${session.id}, title="${session.title}", project=${currentProject.worktree}`,
    );

    currentSession = {
      id: session.id,
      title: session.title,
      directory: currentProject.worktree,
    };

    setCurrentSession(currentSession, scopeKey);
    await ingestSessionInfoForCache(session);

    // Create pinned message for new session
    if (usePinned) {
      try {
        await pinnedMessageManager.onSessionChange(session.id, session.title, scopeKey);
      } catch (err) {
        logger.error("[Bot] Error creating pinned message for new session:", err);
      }
    }

    if (usePinned && pinnedMessageManager.getContextLimit(scopeKey) === 0) {
      await pinnedMessageManager.refreshContextLimit(scopeKey);
    }

    const currentAgent = await resolveProjectAgent(getStoredAgent(scopeKey), scopeKey);
    const currentModel = getStoredModel(scopeKey);
    const contextInfo =
      (usePinned ? pinnedMessageManager.getContextInfo(scopeKey) : null) ??
      keyboardManager.getContextInfo(scopeKey) ??
      (usePinned && pinnedMessageManager.getContextLimit(scopeKey) > 0
        ? { tokensUsed: 0, tokensLimit: pinnedMessageManager.getContextLimit(scopeKey) }
        : null);
    const variantName = formatVariantForButton(currentModel.variant || "default");
    const keyboard = createMainKeyboard(
      currentAgent,
      currentModel,
      contextInfo ?? undefined,
      variantName,
    );

    await ctx.reply(t("bot.session_created", { title: session.title }), {
      reply_markup: keyboard,
    });
  } else {
    logger.info(
      `[Bot] Using existing session: id=${currentSession.id}, title="${currentSession.title}"`,
    );

    // Ensure pinned message exists for existing session
    if (usePinned && !pinnedMessageManager.getState(scopeKey).messageId) {
      try {
        await pinnedMessageManager.onSessionChange(
          currentSession.id,
          currentSession.title,
          scopeKey,
        );
      } catch (err) {
        logger.error("[Bot] Error creating pinned message for existing session:", err);
      }
    }
  }

  await ensureEventSubscription(currentSession.directory);

  summaryAggregator.setSession(currentSession.id);

  const sessionIsBusy = await isSessionBusy(currentSession.id, currentSession.directory);
  if (sessionIsBusy) {
    const currentAgent = await resolveProjectAgent(getStoredAgent(scopeKey), scopeKey);
    const storedModel = getStoredModel(scopeKey);
    const queuedRequest = buildPromptRequest(
      currentSession,
      currentAgent,
      storedModel,
      text,
      fileParts,
    );
    const position = enqueuePromptRequest({
      sessionId: currentSession.id,
      chatId: ctx.chat!.id,
      threadId: scope?.threadId ?? null,
      responseMode,
      promptOptions: queuedRequest.promptOptions,
      promptErrorLogContext: queuedRequest.promptErrorLogContext,
      notifyOnQueue: true,
    });

    logger.info(
      `[Bot] Queued prompt for busy session ${currentSession.id} at position ${position}`,
    );
    await ctx.reply(t("bot.session_queued", { position: String(position) }));
    return true;
  }

  try {
    const currentAgent = await resolveProjectAgent(getStoredAgent(scopeKey), scopeKey);
    const storedModel = getStoredModel(scopeKey);

    const request = buildPromptRequest(currentSession, currentAgent, storedModel, text, fileParts);
    submitPromptRequest(bot, {
      sessionId: currentSession.id,
      chatId: ctx.chat!.id,
      threadId: scope?.threadId ?? null,
      responseMode,
      promptOptions: request.promptOptions,
      promptErrorLogContext: request.promptErrorLogContext,
      notifyOnQueue: true,
    });

    return true;
  } catch (err) {
    logger.error("Error in prompt handler:", err);
    if (interactionManager.getSnapshot(scopeKey)) {
      clearAllInteractionState(INTERACTION_CLEAR_REASON.MESSAGE_HANDLER_ERROR, scopeKey);
    }
    await ctx.reply(t("error.generic"));
    return false;
  }
}
