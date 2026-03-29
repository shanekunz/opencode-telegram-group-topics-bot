import { Bot, Context, InputFile, NextFunction } from "grammy";
import { promises as fs } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { SocksProxyAgent } from "socks-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { config } from "../config.js";
import { authMiddleware } from "./middleware/auth.js";
import { interactionGuardMiddleware } from "./middleware/interaction-guard.js";
import { scheduledOutputTopicMiddleware } from "./middleware/scheduled-output-topic.js";
import { unknownCommandMiddleware } from "./middleware/unknown-command.js";
import { BOT_COMMANDS, getLocalizedDmBotCommands } from "./commands/definitions.js";
import { startCommand } from "./commands/start.js";
import { helpCommand } from "./commands/help.js";
import { lastCommand } from "./commands/last.js";
import { statusCommand } from "./commands/status.js";
import {
  AGENT_MODE_BUTTON_TEXT_PATTERN,
  MODEL_BUTTON_TEXT_PATTERN,
  VARIANT_BUTTON_TEXT_PATTERN,
} from "./message-patterns.js";
import { sessionsCommand, handleSessionSelect } from "./commands/sessions.js";
import { createNewCommand } from "./commands/new.js";
import { projectsCommand, handleProjectSelect } from "./commands/projects.js";
import { taskCommand, handleTaskTextAnswer } from "./commands/task.js";
import { handleTaskListCallback, taskListCommand } from "./commands/tasklist.js";
import { abortCommand } from "./commands/abort.js";
import { opencodeStartCommand } from "./commands/opencode-start.js";
import { opencodeStopCommand } from "./commands/opencode-stop.js";
import { renameCommand, handleRenameCancel, handleRenameTextAnswer } from "./commands/rename.js";
import {
  commandsCommand,
  handleCommandsCallback,
  handleCommandTextArguments,
} from "./commands/commands.js";
import {
  handleQuestionCallback,
  showCurrentQuestion,
  handleQuestionTextAnswer,
} from "./handlers/question.js";
import { handlePermissionCallback, showPermissionRequest } from "./handlers/permission.js";
import { handleAgentSelect, showAgentSelectionMenu } from "./handlers/agent.js";
import { handleModelSelect, showModelSelectionMenu } from "./handlers/model.js";
import { handleVariantSelect, showVariantSelectionMenu } from "./handlers/variant.js";
import { handleContextButtonPress, handleCompactConfirm } from "./handlers/context.js";
import { handleInlineMenuCancel } from "./handlers/inline-menu.js";
import { questionManager } from "../question/manager.js";
import { interactionManager } from "../interaction/manager.js";
import { clearAllInteractionState } from "../interaction/cleanup.js";
import { keyboardManager } from "../keyboard/manager.js";
import { subscribeToEvents } from "../opencode/events.js";
import { summaryAggregator } from "../summary/aggregator.js";
import { formatSummary, formatToolInfo, getAssistantParseMode } from "../summary/formatter.js";
import { renderSubagentCards } from "../summary/subagent-formatter.js";
import { ToolMessageBatcher } from "../summary/tool-message-batcher.js";
import { ingestSessionInfoForCache } from "../session/cache-manager.js";
import { logger } from "../utils/logger.js";
import { safeBackgroundTask } from "../utils/safe-background-task.js";
import { pinnedMessageManager } from "../pinned/manager.js";
import { taskCreationManager } from "../scheduled-task/creation-manager.js";
import { t } from "../i18n/index.js";
import { dispatchNextQueuedPrompt, processUserPrompt } from "./handlers/prompt.js";
import { handleVoiceMessage } from "./handlers/voice.js";
import { handleDocumentMessage } from "./handlers/document.js";
import { downloadTelegramFile, toDataUri } from "./utils/file-download.js";
import { sendBotText } from "./utils/telegram-text.js";
import { editBotText } from "./utils/telegram-text.js";
import { extractCommandName } from "./utils/commands.js";
import {
  isOperationAbortedSessionError,
  SessionErrorThrottle,
} from "./utils/session-error-filter.js";
import { getModelCapabilities, supportsInput } from "../model/capabilities.js";
import { getStoredModel } from "../model/manager.js";
import { getCurrentProject } from "../settings/manager.js";
import {
  GLOBAL_SCOPE_KEY,
  SCOPE_CONTEXT,
  getChatActionThreadOptions,
  getScopeFromContext,
  getThreadSendOptions,
} from "./scope.js";
import { TelegramRateLimiter } from "./telegram-rate-limiter.js";
import type { Event as OpenCodeEvent, FilePartInput } from "@opencode-ai/sdk/v2";
import { getSessionRouteTarget, listAllTopicBindings } from "../topic/manager.js";
import { BOT_COMMAND, DM_ALLOWED_COMMANDS } from "./commands/constants.js";
import { INTERACTION_CLEAR_REASON } from "../interaction/constants.js";
import { BOT_I18N_KEY, CHAT_TYPE, GENERAL_TOPIC, TELEGRAM_CHAT_FIELD } from "./constants.js";
import { TELEGRAM_CHAT_ACTION } from "./telegram-constants.js";
import { syncTopicTitleForSession } from "../topic/title-sync.js";
import { finalizeAssistantResponse } from "./utils/finalize-assistant-response.js";
import { ResponseStreamer } from "./streaming/response-streamer.js";
import { ToolCallStreamer } from "./streaming/tool-call-streamer.js";

let botInstance: Bot<Context> | null = null;
const initializedCommandChats = new Set<number>();
const renamedGeneralTopicChats = new Set<number>();
const DM_ALLOWED_COMMAND_SET = new Set<string>(DM_ALLOWED_COMMANDS);
const telegramRateLimiter = new TelegramRateLimiter();
const eventCallbackByDirectory = new Map<string, (event: OpenCodeEvent) => void>();
const sessionDeliveryTasks = new Map<string, Promise<void>>();

function enqueueSessionDelivery(sessionId: string, task: () => Promise<void>): void {
  const previousTask = sessionDeliveryTasks.get(sessionId) ?? Promise.resolve();
  const nextTask = previousTask
    .catch(() => undefined)
    .then(task)
    .catch((error) => {
      logger.error("[Bot] Session delivery task failed", {
        sessionId,
        error,
      });
    })
    .finally(() => {
      if (sessionDeliveryTasks.get(sessionId) === nextTask) {
        sessionDeliveryTasks.delete(sessionId);
      }
    });

  sessionDeliveryTasks.set(sessionId, nextTask);
}

async function ensureGeneralTopicName(ctx: Context): Promise<void> {
  if (!ctx.chat || ctx.chat.type === CHAT_TYPE.PRIVATE) {
    return;
  }

  if (renamedGeneralTopicChats.has(ctx.chat.id)) {
    return;
  }

  const isForumEnabled = Reflect.get(ctx.chat, TELEGRAM_CHAT_FIELD.IS_FORUM) === true;
  if (!isForumEnabled) {
    return;
  }

  try {
    await ctx.api.editGeneralForumTopic(ctx.chat.id, GENERAL_TOPIC.NAME);
    renamedGeneralTopicChats.add(ctx.chat.id);
    logger.info(`[Bot] Renamed General topic in chat ${ctx.chat.id} to "${GENERAL_TOPIC.NAME}"`);
  } catch (error) {
    logger.debug("[Bot] Failed to rename General topic", {
      chatId: ctx.chat.id,
      error,
    });
  }
}

function rememberScopeTarget(ctx: Context): void {
  const scope = getScopeFromContext(ctx);
  if (!scope) {
    return;
  }

  telegramRateLimiter.setActiveScopeKey(scope.key);
}

function isReplyKeyboardControlText(text: string): boolean {
  return (
    AGENT_MODE_BUTTON_TEXT_PATTERN.test(text) ||
    MODEL_BUTTON_TEXT_PATTERN.test(text) ||
    VARIANT_BUTTON_TEXT_PATTERN.test(text) ||
    /^📊(?:\s|$)/.test(text) ||
    text === t("keyboard.general_defaults")
  );
}

function bindBotInstance(bot: Bot<Context>): void {
  botInstance = bot;
}

function getTargetBySessionId(
  sessionId: string,
): { chatId: number; threadId: number | null; scopeKey: string } | null {
  const target = getSessionRouteTarget(sessionId);
  if (!target) {
    return null;
  }

  return {
    chatId: target.chatId,
    threadId: target.threadId,
    scopeKey: target.scopeKey,
  };
}

function extractSessionTitleUpdate(
  event: OpenCodeEvent,
): { sessionId: string; title: string } | null {
  if (event.type !== "session.updated") {
    return null;
  }

  const eventProperties = event.properties as {
    info?: { id?: unknown; title?: unknown };
    session?: { id?: unknown; title?: unknown };
    sessionID?: unknown;
    title?: unknown;
  };

  const infoSessionId =
    typeof eventProperties.info?.id === "string" ? eventProperties.info.id : null;
  const infoTitle =
    typeof eventProperties.info?.title === "string" ? eventProperties.info.title : null;
  if (infoSessionId && infoTitle) {
    return { sessionId: infoSessionId, title: infoTitle };
  }

  const sessionId =
    typeof eventProperties.session?.id === "string"
      ? eventProperties.session.id
      : typeof eventProperties.sessionID === "string"
        ? eventProperties.sessionID
        : null;

  const title =
    typeof eventProperties.session?.title === "string"
      ? eventProperties.session.title
      : typeof eventProperties.title === "string"
        ? eventProperties.title
        : null;

  if (!sessionId || !title) {
    return null;
  }

  return { sessionId, title };
}

const TELEGRAM_DOCUMENT_CAPTION_MAX_LENGTH = 1024;
const SUBAGENT_STREAM_PREFIX = "🧩";
const sessionErrorThrottle = new SessionErrorThrottle(3000);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.join(__dirname, "..", ".tmp");

function isGroupGeneralControlScope(ctx: Context): boolean {
  const scope = getScopeFromContext(ctx);
  const isForumEnabled =
    ctx.chat?.type === CHAT_TYPE.SUPERGROUP &&
    Reflect.get(ctx.chat, TELEGRAM_CHAT_FIELD.IS_FORUM) === true;

  return Boolean(isForumEnabled && scope?.context === SCOPE_CONTEXT.GROUP_GENERAL && ctx.chat);
}

async function replyGeneralControlPromptRestriction(ctx: Context): Promise<void> {
  await ctx.reply(
    t(BOT_I18N_KEY.GROUP_GENERAL_PROMPTS_DISABLED),
    getThreadSendOptions(getScopeFromContext(ctx)?.threadId ?? null),
  );
}

function prepareDocumentCaption(caption: string): string {
  const normalizedCaption = caption.trim();
  if (!normalizedCaption) {
    return "";
  }

  if (normalizedCaption.length <= TELEGRAM_DOCUMENT_CAPTION_MAX_LENGTH) {
    return normalizedCaption;
  }

  return `${normalizedCaption.slice(0, TELEGRAM_DOCUMENT_CAPTION_MAX_LENGTH - 3)}...`;
}

async function sendSessionTextMessage(
  sessionId: string,
  text: string,
  format: "raw" | "markdown_v2" = "raw",
): Promise<number | null> {
  if (!botInstance) {
    return null;
  }

  const target = getTargetBySessionId(sessionId);
  if (!target) {
    return null;
  }

  const message = await sendBotText({
    api: botInstance.api,
    chatId: target.chatId,
    text,
    options: {
      disable_notification: true,
      ...getThreadSendOptions(target.threadId),
    },
    format,
  });

  return message.message_id;
}

async function editSessionTextMessage(
  sessionId: string,
  messageId: number,
  text: string,
  format: "raw" | "markdown_v2" = "raw",
  _includeKeyboard: boolean = false,
): Promise<void> {
  if (!botInstance) {
    return;
  }

  const target = getTargetBySessionId(sessionId);
  if (!target) {
    return;
  }

  await editBotText({
    api: botInstance.api,
    chatId: target.chatId,
    messageId,
    text,
    format,
  });
}

async function deleteSessionMessage(sessionId: string, messageId: number): Promise<void> {
  if (!botInstance) {
    return;
  }

  const target = getTargetBySessionId(sessionId);
  if (!target) {
    return;
  }

  await botInstance.api.deleteMessage(target.chatId, messageId);
}

const responseStreamer = new ResponseStreamer({
  sendText: sendSessionTextMessage,
  editText: editSessionTextMessage,
  deleteMessage: deleteSessionMessage,
});

const toolCallStreamer = new ToolCallStreamer({
  sendText: async (sessionId, text) => await sendSessionTextMessage(sessionId, text, "raw"),
  editText: async (sessionId, messageId, text) =>
    await editSessionTextMessage(sessionId, messageId, text, "raw"),
  deleteMessage: deleteSessionMessage,
});

const toolMessageBatcher = new ToolMessageBatcher({
  intervalSeconds: 5,
  sendText: async (sessionId, text) => {
    if (!botInstance) {
      return;
    }

    const target = getTargetBySessionId(sessionId);
    if (!target) {
      return;
    }

    await botInstance.api.sendMessage(target.chatId, text, {
      disable_notification: true,
      ...getThreadSendOptions(target.threadId),
    });
  },
  sendFile: async (sessionId, fileData) => {
    if (!botInstance) {
      return;
    }

    const target = getTargetBySessionId(sessionId);
    if (!target) {
      return;
    }

    const tempFilePath = path.join(TEMP_DIR, fileData.filename);

    try {
      logger.debug(
        `[Bot] Sending code file: ${fileData.filename} (${fileData.buffer.length} bytes, session=${sessionId})`,
      );

      await fs.mkdir(TEMP_DIR, { recursive: true });
      await fs.writeFile(tempFilePath, fileData.buffer);

      await botInstance.api.sendDocument(target.chatId, new InputFile(tempFilePath), {
        caption: fileData.caption,
        disable_notification: true,
        ...getThreadSendOptions(target.threadId),
      });
    } finally {
      await fs.unlink(tempFilePath).catch(() => {});
    }
  },
});

async function ensureCommandsInitialized(ctx: Context, next: NextFunction): Promise<void> {
  if (!ctx.from || ctx.from.id !== config.telegram.allowedUserId) {
    await next();
    return;
  }

  if (!ctx.chat) {
    logger.warn("[Bot] Cannot initialize commands: chat context is missing");
    await next();
    return;
  }

  if (initializedCommandChats.has(ctx.chat.id)) {
    await next();
    return;
  }

  try {
    if (ctx.chat.type === CHAT_TYPE.PRIVATE) {
      await ctx.api.setMyCommands(getLocalizedDmBotCommands(), {
        scope: {
          type: "chat",
          chat_id: ctx.chat.id,
        },
      });
    } else {
      await ctx.api.setMyCommands(BOT_COMMANDS, {
        scope: {
          type: "chat_member",
          chat_id: ctx.chat.id,
          user_id: ctx.from.id,
        },
      });
    }

    initializedCommandChats.add(ctx.chat.id);
    logger.info(
      `[Bot] Commands initialized for authorized user in chat (chat_id=${ctx.chat.id}, user_id=${ctx.from.id})`,
    );
  } catch (err) {
    logger.error("[Bot] Failed to set commands:", err);
  }

  await next();
}

async function ensureEventSubscription(directory: string): Promise<void> {
  if (!directory) {
    logger.error("No directory found for event subscription");
    return;
  }

  toolMessageBatcher.setIntervalSeconds(config.bot.serviceMessagesIntervalSec);
  summaryAggregator.setOnCleared(() => {
    toolMessageBatcher.clearAll("summary_aggregator_clear");
    void toolCallStreamer.clearAll("summary_aggregator_clear");
    void responseStreamer.clearAll("summary_aggregator_clear");
  });

  summaryAggregator.setOnMessageUpdated((sessionId, messageText) => {
    enqueueSessionDelivery(sessionId, async () => {
      const parts = formatSummary(messageText);
      const assistantParseMode = getAssistantParseMode();
      const assistantMessageFormat = assistantParseMode === "MarkdownV2" ? "markdown_v2" : "raw";

      if (parts.length !== 1) {
        responseStreamer.markFallback(sessionId);
        await toolCallStreamer.clearThinkingOnlySession(sessionId);
        return;
      }

      await toolCallStreamer.clearThinkingOnlySession(sessionId);
      await responseStreamer.update(sessionId, parts[0], assistantMessageFormat);
    });
  });

  summaryAggregator.setOnComplete((sessionId, messageText) => {
    enqueueSessionDelivery(sessionId, async () => {
      if (!botInstance) {
        logger.error("Bot not available for sending message");
        return;
      }

      const target = getTargetBySessionId(sessionId);
      if (!target) {
        return;
      }

      await toolMessageBatcher.flushSession(sessionId, "assistant_message_completed");
      await toolCallStreamer.clearSession(sessionId, "assistant_message_completed");

      try {
        const activeBot = botInstance;
        if (!activeBot) {
          return;
        }

        const result = await finalizeAssistantResponse({
          sessionId,
          messageText,
          responseStreamer,
          sendFallback: async (parts, assistantMessageFormat) => {
            logger.debug(
              `[Bot] Sending completed message to Telegram (chatId=${target.chatId}, parts=${parts.length})`,
            );

            for (let i = 0; i < parts.length; i++) {
              const isLastPart = i === parts.length - 1;
              const keyboard =
                isLastPart && keyboardManager.isInitialized(target.scopeKey)
                  ? keyboardManager.getKeyboard(target.scopeKey)
                  : undefined;
              const options = keyboard ? { reply_markup: keyboard } : undefined;

              await sendBotText({
                api: activeBot.api,
                chatId: target.chatId,
                text: parts[i],
                options: {
                  ...(options || {}),
                  ...getThreadSendOptions(target.threadId),
                },
                format: assistantMessageFormat,
              });
            }
          },
        });

        logger.debug("[Bot] Assistant completion finalized", {
          sessionId,
          streamed: result.streamed,
          partCount: result.partCount,
        });
      } catch (err) {
        logger.error("Failed to send message to Telegram:", err);
        logger.warn("[Bot] Assistant message delivery failed; keeping event processing active");
      }
    });
  });

  summaryAggregator.setOnTool(async (toolInfo) => {
    if (!botInstance) {
      logger.error("Bot or chat ID not available for sending tool notification");
      return;
    }

    const shouldIncludeToolInfoInFileCaption =
      toolInfo.hasFileAttachment &&
      (toolInfo.tool === "write" || toolInfo.tool === "edit" || toolInfo.tool === "apply_patch");

    if (
      config.bot.hideToolCallMessages ||
      shouldIncludeToolInfoInFileCaption ||
      toolInfo.tool === "task"
    ) {
      return;
    }

    try {
      const target = getTargetBySessionId(toolInfo.sessionId);
      const projectWorktree = target ? getCurrentProject(target.scopeKey)?.worktree : undefined;
      const message = formatToolInfo(toolInfo, projectWorktree);
      if (message) {
        const status = "status" in toolInfo.state ? toolInfo.state.status : undefined;

        if (status === "running") {
          toolCallStreamer.pushUpdate(toolInfo.sessionId, `⏳ ${message}`);
          return;
        }

        if (status === "error") {
          toolCallStreamer.pushUpdate(toolInfo.sessionId, `❌ ${message}`);
          return;
        }

        toolCallStreamer.pushUpdate(toolInfo.sessionId, `✅ ${message}`);
      }
    } catch (err) {
      logger.error("Failed to send tool notification to Telegram:", err);
    }
  });

  summaryAggregator.setOnSubagent((sessionId, subagents) => {
    if (config.bot.hideToolCallMessages) {
      return;
    }

    try {
      const renderedCards = renderSubagentCards(subagents);
      toolCallStreamer.replaceByPrefix(sessionId, SUBAGENT_STREAM_PREFIX, renderedCards);
    } catch (err) {
      logger.error("Failed to render subagent activity for Telegram:", err);
    }
  });

  summaryAggregator.setOnToolFile(async (fileInfo) => {
    if (!botInstance) {
      logger.error("Bot or chat ID not available for sending file");
      return;
    }

    try {
      const target = getTargetBySessionId(fileInfo.sessionId);
      const projectWorktree = target ? getCurrentProject(target.scopeKey)?.worktree : undefined;
      const toolMessage = formatToolInfo(fileInfo, projectWorktree);
      const caption = prepareDocumentCaption(toolMessage || fileInfo.fileData.caption);

      toolMessageBatcher.enqueueFile(fileInfo.sessionId, {
        ...fileInfo.fileData,
        caption,
      });
    } catch (err) {
      logger.error("Failed to send file to Telegram:", err);
    }
  });

  summaryAggregator.setOnQuestion((sessionId, questions, requestID) => {
    enqueueSessionDelivery(sessionId, async () => {
      if (!botInstance) {
        logger.error("Bot or chat ID not available for showing questions");
        return;
      }

      await toolMessageBatcher.flushSession(sessionId, "question_asked");
      await toolCallStreamer.clearSession(sessionId, "question_asked");

      const target = getTargetBySessionId(sessionId);
      if (!target) {
        return;
      }

      if (questionManager.isActive(target.scopeKey)) {
        logger.warn("[Bot] Replacing active poll with a new one");

        const previousMessageIds = questionManager.getMessageIds(target.scopeKey);
        for (const messageId of previousMessageIds) {
          await botInstance.api.deleteMessage(target.chatId, messageId).catch(() => {});
        }

        clearAllInteractionState(
          INTERACTION_CLEAR_REASON.QUESTION_REPLACED_BY_NEW_POLL,
          target.scopeKey,
        );
      }

      logger.info(
        `[Bot] Received ${questions.length} questions from agent, requestID=${requestID}`,
      );
      questionManager.startQuestions(questions, requestID, target.scopeKey);
      await showCurrentQuestion(botInstance.api, target.chatId, target.scopeKey, target.threadId);
    });
  });

  summaryAggregator.setOnQuestionError(async () => {
    logger.info(`[Bot] Question tool failed, clearing active poll and deleting messages`);

    const bindings = listAllTopicBindings();
    for (const binding of bindings) {
      const messageIds = questionManager.getMessageIds(binding.scopeKey);
      for (const messageId of messageIds) {
        await botInstance?.api.deleteMessage(binding.chatId, messageId).catch((err) => {
          logger.error(`[Bot] Failed to delete question message ${messageId}:`, err);
        });
      }

      clearAllInteractionState(INTERACTION_CLEAR_REASON.QUESTION_ERROR, binding.scopeKey);
    }

    clearAllInteractionState(INTERACTION_CLEAR_REASON.QUESTION_ERROR, GLOBAL_SCOPE_KEY);
  });

  summaryAggregator.setOnPermission((request) => {
    enqueueSessionDelivery(request.sessionID, async () => {
      if (!botInstance) {
        logger.error("Bot or chat ID not available for showing permission request");
        return;
      }

      const target = getTargetBySessionId(request.sessionID);
      if (!target) {
        return;
      }

      await toolMessageBatcher.flushSession(request.sessionID, "permission_asked");
      await toolCallStreamer.clearSession(request.sessionID, "permission_asked");

      logger.info(
        `[Bot] Received permission request from agent: type=${request.permission}, requestID=${request.id}`,
      );
      await showPermissionRequest(
        botInstance.api,
        target.chatId,
        request,
        target.scopeKey,
        target.threadId,
      );
    });
  });

  summaryAggregator.setOnTypingIndicator((sessionId) => {
    if (!botInstance) {
      return;
    }

    const target = getTargetBySessionId(sessionId);
    if (!target) {
      return;
    }

    void botInstance.api
      .sendChatAction(
        target.chatId,
        TELEGRAM_CHAT_ACTION.TYPING,
        getChatActionThreadOptions(target.threadId),
      )
      .catch((error) => {
        logger.debug("[Bot] Failed to send typing indicator", {
          sessionId,
          chatId: target.chatId,
          threadId: target.threadId,
          error,
        });
      });
  });

  summaryAggregator.setOnThinking(async (sessionId) => {
    if (config.bot.hideThinkingMessages) {
      return;
    }

    if (!botInstance) {
      return;
    }

    const target = getTargetBySessionId(sessionId);
    if (!target) {
      return;
    }

    logger.debug("[Bot] Agent started thinking");

    toolCallStreamer.showThinking(sessionId, t("bot.thinking"));
  });

  summaryAggregator.setOnTokens(async (sessionId, tokens) => {
    const target = getTargetBySessionId(sessionId);
    if (!target) {
      return;
    }

    try {
      logger.debug(`[Bot] Received tokens: input=${tokens.input}, output=${tokens.output}`);

      // Update keyboardManager SYNCHRONOUSLY before any await
      // This ensures keyboard has correct context when onComplete sends the reply
      const contextSize = tokens.input + tokens.cacheRead;
      const contextLimit = pinnedMessageManager.getContextLimit(target.scopeKey);
      if (contextLimit > 0) {
        keyboardManager.updateContext(contextSize, contextLimit, target.scopeKey);
      }

      if (pinnedMessageManager.isInitialized(target.scopeKey)) {
        await pinnedMessageManager.onMessageComplete(tokens, target.scopeKey);
      }
    } catch (err) {
      logger.error("[Bot] Error updating pinned message with tokens:", err);
    }
  });

  summaryAggregator.setOnSessionCompacted(async (sessionId, directory) => {
    const target = getTargetBySessionId(sessionId);
    if (!target || !pinnedMessageManager.isInitialized(target.scopeKey)) {
      return;
    }

    try {
      logger.info(`[Bot] Session compacted, reloading context: ${sessionId}`);
      await pinnedMessageManager.onSessionCompacted(sessionId, directory, target.scopeKey);
    } catch (err) {
      logger.error("[Bot] Error reloading context after compaction:", err);
    }
  });

  summaryAggregator.setOnSessionIdle((sessionId) => {
    enqueueSessionDelivery(sessionId, async () => {
      await toolMessageBatcher.flushSession(sessionId, "session_idle");
      await toolCallStreamer.clearSession(sessionId, "session_idle");
      await dispatchNextQueuedPrompt(sessionId);
    });
  });

  summaryAggregator.setOnSessionError(async (sessionId, message) => {
    enqueueSessionDelivery(sessionId, async () => {
      if (!botInstance) {
        return;
      }

      const target = getTargetBySessionId(sessionId);
      if (!target) {
        return;
      }

      await toolMessageBatcher.flushSession(sessionId, "session_error");
      await toolCallStreamer.clearSession(sessionId, "session_error");

      const normalizedMessage = message.trim() || t("common.unknown_error");

      if (isOperationAbortedSessionError(normalizedMessage)) {
        logger.info(`[Bot] Suppressing session.abort error notification for ${sessionId}`);
        return;
      }

      if (sessionErrorThrottle.shouldSuppress(sessionId, normalizedMessage)) {
        logger.debug(`[Bot] Suppressing duplicate session.error notification for ${sessionId}`);
        return;
      }

      const truncatedMessage =
        normalizedMessage.length > 3500
          ? `${normalizedMessage.slice(0, 3497)}...`
          : normalizedMessage;

      await botInstance.api
        .sendMessage(target.chatId, t("bot.session_error", { message: truncatedMessage }), {
          ...getThreadSendOptions(target.threadId),
        })
        .catch((err) => {
          logger.error("[Bot] Failed to send session.error message:", err);
        });
    });
  });

  summaryAggregator.setOnSessionRetry(async ({ sessionId, message }) => {
    if (!botInstance) {
      return;
    }

    const normalizedMessage = message.trim() || t("common.unknown_error");
    const truncatedMessage =
      normalizedMessage.length > 3500
        ? `${normalizedMessage.slice(0, 3497)}...`
        : normalizedMessage;

    const retryMessage = t("bot.session_retry", { message: truncatedMessage });
    toolCallStreamer.pushUpdate(sessionId, retryMessage);
  });

  summaryAggregator.setOnSessionDiff(async (sessionId, diffs) => {
    const target = getTargetBySessionId(sessionId);
    if (!target || !pinnedMessageManager.isInitialized(target.scopeKey)) {
      return;
    }

    try {
      await pinnedMessageManager.onSessionDiff(diffs, target.scopeKey);
    } catch (err) {
      logger.error("[Bot] Error updating session diff:", err);
    }
  });

  summaryAggregator.setOnFileChange((change, sessionId) => {
    const target = getTargetBySessionId(sessionId);
    if (!target || !pinnedMessageManager.isInitialized(target.scopeKey)) {
      return;
    }
    pinnedMessageManager.addFileChange(change, target.scopeKey);
  });

  pinnedMessageManager.setOnKeyboardUpdate(async (tokensUsed, tokensLimit, scopeKey) => {
    try {
      logger.debug(`[Bot] Updating keyboard with context: ${tokensUsed}/${tokensLimit}`);
      keyboardManager.updateContext(tokensUsed, tokensLimit, scopeKey);
      // Don't send automatic keyboard updates - keyboard will update naturally with user messages
    } catch (err) {
      logger.error("[Bot] Error updating keyboard context:", err);
    }
  });

  let eventCallback = eventCallbackByDirectory.get(directory);

  if (!eventCallback) {
    eventCallback = (event: OpenCodeEvent): void => {
      if (event.type === "session.created" || event.type === "session.updated") {
        const info = (
          event.properties as { info?: { directory?: string; time?: { updated?: number } } }
        ).info;

        if (info?.directory) {
          safeBackgroundTask({
            taskName: `session.cache.${event.type}`,
            task: () => ingestSessionInfoForCache(info),
          });
        }
      }

      const sessionTitleUpdate = extractSessionTitleUpdate(event);
      if (sessionTitleUpdate && botInstance) {
        const activeBot = botInstance;
        safeBackgroundTask({
          taskName: "topic.title.sync_from_event",
          task: () =>
            syncTopicTitleForSession(
              activeBot.api,
              sessionTitleUpdate.sessionId,
              sessionTitleUpdate.title,
            ),
          onError: (syncError) => {
            logger.debug("[Bot] Failed to sync topic title from session.updated", {
              sessionId: sessionTitleUpdate.sessionId,
              syncError,
            });
          },
        });
      }

      summaryAggregator.processEvent(event);
    };

    eventCallbackByDirectory.set(directory, eventCallback);
    logger.info(`[Bot] Subscribing to OpenCode events for project: ${directory}`);
  }

  subscribeToEvents(directory, eventCallback).catch((err) => {
    logger.error("Failed to subscribe to events:", err);
  });
}

export function createBot(): Bot<Context> {
  clearAllInteractionState(INTERACTION_CLEAR_REASON.BOT_STARTUP);
  toolMessageBatcher.setIntervalSeconds(config.bot.serviceMessagesIntervalSec);
  logger.info(`[ToolBatcher] Service messages interval: ${config.bot.serviceMessagesIntervalSec}s`);

  const botOptions: ConstructorParameters<typeof Bot<Context>>[1] = {};

  if (config.telegram.proxyUrl) {
    const proxyUrl = config.telegram.proxyUrl;
    let agent;

    if (proxyUrl.startsWith("socks")) {
      agent = new SocksProxyAgent(proxyUrl);
      logger.info(`[Bot] Using SOCKS proxy: ${proxyUrl.replace(/\/\/.*@/, "//***@")}`);
    } else {
      agent = new HttpsProxyAgent(proxyUrl);
      logger.info(`[Bot] Using HTTP/HTTPS proxy: ${proxyUrl.replace(/\/\/.*@/, "//***@")}`);
    }

    botOptions.client = {
      baseFetchConfig: {
        agent,
        compress: true,
      },
    };
  }

  const bot = new Bot(config.telegram.token, botOptions);
  bindBotInstance(bot);

  bot.api.config.use((prev, method, payload, signal) => {
    return telegramRateLimiter.enqueue(method, payload, () => prev(method, payload, signal));
  });

  // Heartbeat for diagnostics: verify the event loop is not blocked
  let heartbeatCounter = 0;
  setInterval(() => {
    heartbeatCounter++;
    if (heartbeatCounter % 6 === 0) {
      // Log every 30 seconds (5 sec * 6)
      logger.debug(`[Bot] Heartbeat #${heartbeatCounter} - event loop alive`);
    }
  }, 5000);

  // Log all API calls for diagnostics
  let lastGetUpdatesTime = Date.now();
  bot.api.config.use(async (prev, method, payload, signal) => {
    if (method === "getUpdates") {
      const now = Date.now();
      const timeSinceLast = now - lastGetUpdatesTime;
      logger.debug(`[Bot API] getUpdates called (${timeSinceLast}ms since last)`);
      lastGetUpdatesTime = now;
    } else if (method === "sendMessage") {
      logger.debug(`[Bot API] sendMessage to chat ${(payload as { chat_id?: number }).chat_id}`);
    }
    return prev(method, payload, signal);
  });

  bot.use((ctx, next) => {
    bindBotInstance(bot);
    rememberScopeTarget(ctx);

    const hasCallbackQuery = !!ctx.callbackQuery;
    const hasMessage = !!ctx.message;
    const callbackData = ctx.callbackQuery?.data || "N/A";
    logger.debug(
      `[DEBUG] Incoming update: hasCallbackQuery=${hasCallbackQuery}, hasMessage=${hasMessage}, callbackData=${callbackData}`,
    );
    return next();
  });

  bot.use(authMiddleware);
  bot.use(async (ctx, next) => {
    if (ctx.message && ctx.chat?.type !== CHAT_TYPE.PRIVATE) {
      await ensureGeneralTopicName(ctx);
    }

    await next();
  });
  bot.use(ensureCommandsInitialized);
  bot.use(interactionGuardMiddleware);
  bot.use(scheduledOutputTopicMiddleware);
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== CHAT_TYPE.PRIVATE) {
      await next();
      return;
    }

    const text = ctx.message?.text;
    if (text) {
      const commandName = extractCommandName(text);
      if (commandName) {
        if (DM_ALLOWED_COMMAND_SET.has(commandName)) {
          await next();
          return;
        }

        await ctx.reply(t("dm.restricted.command"));
        return;
      }

      await ctx.reply(t("dm.restricted.prompt"));
      return;
    }

    if (ctx.message?.photo || ctx.message?.document || ctx.message?.voice || ctx.message?.audio) {
      await ctx.reply(t("dm.restricted.prompt"));
      return;
    }

    await next();
  });

  const blockMenuWhileInteractionActive = async (
    ctx: Context,
    menuKind?: "agent" | "model" | "variant" | "context",
  ): Promise<boolean> => {
    const activeInteraction = interactionManager.getSnapshot(
      getScopeFromContext(ctx)?.key ?? GLOBAL_SCOPE_KEY,
    );
    if (!activeInteraction) {
      return false;
    }

    const taskStage = String(activeInteraction.metadata.stage ?? "");
    const allowTaskDraftDefaultChange =
      activeInteraction.kind === "task" &&
      activeInteraction.expectedInput === "mixed" &&
      taskStage === "prompt" &&
      (menuKind === "agent" || menuKind === "model" || menuKind === "variant");

    if (allowTaskDraftDefaultChange) {
      return false;
    }

    logger.debug(
      `[Bot] Blocking menu open while interaction active: kind=${activeInteraction.kind}, expectedInput=${activeInteraction.expectedInput}`,
    );
    await ctx.reply(
      activeInteraction.kind === "task"
        ? t("task.blocked.only_defaults_before_prompt")
        : t("interaction.blocked.finish_current"),
    );
    return true;
  };

  bot.command(BOT_COMMAND.START, startCommand);
  bot.command(BOT_COMMAND.HELP, helpCommand);
  bot.command(BOT_COMMAND.STATUS, statusCommand);
  bot.command(BOT_COMMAND.LAST, lastCommand);
  bot.command(BOT_COMMAND.OPENCODE_START, opencodeStartCommand);
  bot.command(BOT_COMMAND.OPENCODE_STOP, opencodeStopCommand);
  bot.command(BOT_COMMAND.PROJECTS, projectsCommand);
  bot.command(BOT_COMMAND.TASK, taskCommand);
  bot.command(BOT_COMMAND.TASKLIST, taskListCommand);
  bot.command(BOT_COMMAND.SESSIONS, sessionsCommand);
  bot.command(BOT_COMMAND.NEW, createNewCommand({ ensureEventSubscription }));
  bot.command(BOT_COMMAND.ABORT, abortCommand);
  bot.command(BOT_COMMAND.RENAME, renameCommand);
  bot.command(BOT_COMMAND.COMMANDS, commandsCommand);

  bot.on("message:text", unknownCommandMiddleware);

  bot.on("callback_query:data", async (ctx) => {
    logger.debug(`[Bot] Received callback_query:data: ${ctx.callbackQuery?.data}`);
    logger.debug(`[Bot] Callback context: from=${ctx.from?.id}, chat=${ctx.chat?.id}`);

    if (ctx.chat) {
      botInstance = bot;
      rememberScopeTarget(ctx);
    }

    try {
      const handledInlineCancel = await handleInlineMenuCancel(ctx);
      const handledSession = await handleSessionSelect(ctx);
      const handledProject = await handleProjectSelect(ctx);
      const handledTaskList = await handleTaskListCallback(ctx);
      const handledQuestion = await handleQuestionCallback(ctx);
      const handledPermission = await handlePermissionCallback(ctx);
      const handledAgent = await handleAgentSelect(ctx);
      const handledModel = await handleModelSelect(ctx);
      const handledVariant = await handleVariantSelect(ctx);
      const handledCompactConfirm = await handleCompactConfirm(ctx);
      const handledRenameCancel = await handleRenameCancel(ctx);
      const handledCommands = await handleCommandsCallback(ctx, { ensureEventSubscription });

      logger.debug(
        `[Bot] Callback handled: inlineCancel=${handledInlineCancel}, session=${handledSession}, project=${handledProject}, taskList=${handledTaskList}, question=${handledQuestion}, permission=${handledPermission}, agent=${handledAgent}, model=${handledModel}, variant=${handledVariant}, compactConfirm=${handledCompactConfirm}, rename=${handledRenameCancel}, commands=${handledCommands}`,
      );

      if (
        !handledInlineCancel &&
        !handledSession &&
        !handledProject &&
        !handledTaskList &&
        !handledQuestion &&
        !handledPermission &&
        !handledAgent &&
        !handledModel &&
        !handledVariant &&
        !handledCompactConfirm &&
        !handledRenameCancel &&
        !handledCommands
      ) {
        logger.debug("Unknown callback query:", ctx.callbackQuery?.data);
        await ctx.answerCallbackQuery({ text: t("callback.unknown_command") });
      }
    } catch (err) {
      logger.error("[Bot] Error handling callback:", err);
      clearAllInteractionState(
        INTERACTION_CLEAR_REASON.CALLBACK_HANDLER_ERROR,
        getScopeFromContext(ctx)?.key ?? GLOBAL_SCOPE_KEY,
      );
      await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    }
  });

  // Handle Reply Keyboard button press (agent mode indicator)
  bot.hears(AGENT_MODE_BUTTON_TEXT_PATTERN, async (ctx) => {
    logger.debug(`[Bot] Agent mode button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx, "agent")) {
        return;
      }

      await showAgentSelectionMenu(ctx);
    } catch (err) {
      logger.error("[Bot] Error showing agent menu:", err);
      await ctx.reply(t("error.load_agents"));
    }
  });

  // Handle Reply Keyboard button press (model selector)
  // Model button text is produced by formatModelForButton() and always starts with "🤖 ".
  bot.hears(MODEL_BUTTON_TEXT_PATTERN, async (ctx) => {
    logger.debug(`[Bot] Model button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx, "model")) {
        return;
      }

      await showModelSelectionMenu(ctx);
    } catch (err) {
      logger.error("[Bot] Error showing model menu:", err);
      await ctx.reply(t("error.load_models"));
    }
  });

  bot.hears(t("keyboard.general_defaults"), async (ctx) => {
    await ctx.reply(
      t("keyboard.general_defaults_info"),
      getThreadSendOptions(getScopeFromContext(ctx)?.threadId ?? null),
    );
  });

  // Handle Reply Keyboard button press (context button)
  bot.hears(/^📊(?:\s|$)/, async (ctx) => {
    logger.debug(`[Bot] Context button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx, "context")) {
        return;
      }

      await handleContextButtonPress(ctx);
    } catch (err) {
      logger.error("[Bot] Error handling context button:", err);
      await ctx.reply(t("error.context_button"));
    }
  });

  // Handle Reply Keyboard button press (variant selector)
  // Keep support for both legacy "💭" and current "💡" prefix.
  bot.hears(VARIANT_BUTTON_TEXT_PATTERN, async (ctx) => {
    logger.debug(`[Bot] Variant button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx, "variant")) {
        return;
      }

      await showVariantSelectionMenu(ctx);
    } catch (err) {
      logger.error("[Bot] Error showing variant menu:", err);
      await ctx.reply(t("error.load_variants"));
    }
  });

  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message?.text;
    if (text) {
      const isCommand = text.startsWith("/");
      logger.debug(
        `[Bot] Received text message: ${isCommand ? `command="${text}"` : `prompt (length=${text.length})`}, chatId=${ctx.chat.id}`,
      );
    }
    await next();
  });

  // Remove any previously set global commands to prevent unauthorized users from seeing them
  safeBackgroundTask({
    taskName: "bot.clearGlobalCommands",
    task: async () => {
      try {
        await Promise.all([
          bot.api.setMyCommands([], { scope: { type: "default" } }),
          bot.api.setMyCommands([], { scope: { type: "all_private_chats" } }),
        ]);
        return { success: true as const };
      } catch (error) {
        return { success: false as const, error };
      }
    },
    onSuccess: (result) => {
      if (result.success) {
        logger.info("[Bot] Cleared global commands (default and all_private_chats scopes)");
        return;
      }

      logger.warn("[Bot] Could not clear global commands:", result.error);
    },
  });

  // Voice and audio message handlers (STT transcription -> prompt)
  const voicePromptDeps = { bot, ensureEventSubscription };

  bot.on("message:voice", async (ctx) => {
    logger.debug(`[Bot] Received voice message, chatId=${ctx.chat.id}`);
    botInstance = bot;
    rememberScopeTarget(ctx);

    if (isGroupGeneralControlScope(ctx)) {
      await replyGeneralControlPromptRestriction(ctx);
      return;
    }

    await handleVoiceMessage(ctx, voicePromptDeps);
  });

  bot.on("message:audio", async (ctx) => {
    logger.debug(`[Bot] Received audio message, chatId=${ctx.chat.id}`);
    botInstance = bot;
    rememberScopeTarget(ctx);

    if (isGroupGeneralControlScope(ctx)) {
      await replyGeneralControlPromptRestriction(ctx);
      return;
    }

    await handleVoiceMessage(ctx, voicePromptDeps);
  });

  // Photo message handler
  bot.on("message:photo", async (ctx) => {
    logger.debug(`[Bot] Received photo message, chatId=${ctx.chat.id}`);

    if (isGroupGeneralControlScope(ctx)) {
      await replyGeneralControlPromptRestriction(ctx);
      return;
    }

    const photos = ctx.message?.photo;
    if (!photos || photos.length === 0) {
      return;
    }

    const caption = ctx.message.caption || "";

    try {
      // Get the largest photo (last element in array)
      const largestPhoto = photos[photos.length - 1];

      // Check model capabilities
      const scopeKey = getScopeFromContext(ctx)?.key ?? GLOBAL_SCOPE_KEY;
      const storedModel = getStoredModel(scopeKey);
      const capabilities = await getModelCapabilities(storedModel.providerID, storedModel.modelID);

      if (!supportsInput(capabilities, "image")) {
        logger.warn(
          `[Bot] Model ${storedModel.providerID}/${storedModel.modelID} doesn't support image input`,
        );
        await ctx.reply(t("bot.photo_model_no_image"));

        // Fall back to caption-only if present
        if (caption.trim().length > 0) {
          botInstance = bot;
          rememberScopeTarget(ctx);
          const promptDeps = { bot, ensureEventSubscription };
          await processUserPrompt(ctx, caption, promptDeps);
        }
        return;
      }

      // Download photo
      await ctx.reply(t("bot.photo_downloading"));
      const downloadedFile = await downloadTelegramFile(ctx.api, largestPhoto.file_id);

      // Convert to data URI (Telegram always converts photos to JPEG)
      const dataUri = toDataUri(downloadedFile.buffer, "image/jpeg");

      // Create file part
      const filePart: FilePartInput = {
        type: "file",
        mime: "image/jpeg",
        filename: "photo.jpg",
        url: dataUri,
      };

      logger.info(`[Bot] Sending photo (${downloadedFile.buffer.length} bytes) with prompt`);

      botInstance = bot;
      rememberScopeTarget(ctx);

      // Send via processUserPrompt with file part
      const promptDeps = { bot, ensureEventSubscription };
      await processUserPrompt(ctx, caption, promptDeps, [filePart]);
    } catch (err) {
      logger.error("[Bot] Error handling photo message:", err);
      await ctx.reply(t("bot.photo_download_error"));
    }
  });

  // Document message handler (PDF and text files)
  bot.on("message:document", async (ctx) => {
    logger.debug(`[Bot] Received document message, chatId=${ctx.chat.id}`);
    botInstance = bot;
    rememberScopeTarget(ctx);

    if (isGroupGeneralControlScope(ctx)) {
      await replyGeneralControlPromptRestriction(ctx);
      return;
    }

    const deps = { bot, ensureEventSubscription };
    await handleDocumentMessage(ctx, deps);
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message?.text;
    if (!text) {
      return;
    }

    botInstance = bot;
    rememberScopeTarget(ctx);

    if (text.startsWith("/")) {
      return;
    }

    const scopeKey = getScopeFromContext(ctx)?.key ?? GLOBAL_SCOPE_KEY;

    if (questionManager.isActive(scopeKey)) {
      await handleQuestionTextAnswer(ctx);
      return;
    }

    const handledRename = await handleRenameTextAnswer(ctx);
    if (handledRename) {
      return;
    }

    const handledTask = await handleTaskTextAnswer(ctx);
    if (handledTask) {
      return;
    }

    if (taskCreationManager.isActive(scopeKey) && isReplyKeyboardControlText(text)) {
      logger.debug("[Bot] Ignoring reply keyboard control text during task setup");
      return;
    }

    const promptDeps = { bot, ensureEventSubscription };
    const handledCommandArgs = await handleCommandTextArguments(ctx, promptDeps);
    if (handledCommandArgs) {
      return;
    }

    if (isGroupGeneralControlScope(ctx)) {
      await replyGeneralControlPromptRestriction(ctx);
      return;
    }

    await processUserPrompt(ctx, text, promptDeps);

    logger.debug("[Bot] message:text handler completed (prompt sent in background)");
  });

  bot.catch((err) => {
    logger.error("[Bot] Unhandled error in bot:", err);
    clearAllInteractionState(
      "bot_unhandled_error",
      err.ctx ? (getScopeFromContext(err.ctx)?.key ?? GLOBAL_SCOPE_KEY) : GLOBAL_SCOPE_KEY,
    );
    if (err.ctx) {
      logger.error(
        "[Bot] Error context - update type:",
        err.ctx.update ? Object.keys(err.ctx.update) : "unknown",
      );
    }
  });

  return bot;
}
