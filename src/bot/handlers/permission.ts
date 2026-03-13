import { Context, InlineKeyboard } from "grammy";
import { permissionManager } from "../../permission/manager.js";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentProject } from "../../settings/manager.js";
import { getCurrentSession, getSessionById } from "../../session/manager.js";
import { summaryAggregator } from "../../summary/aggregator.js";
import { interactionManager } from "../../interaction/manager.js";
import { INTERACTION_CLEAR_REASON } from "../../interaction/constants.js";
import { logger } from "../../utils/logger.js";
import { PermissionRequest, PermissionReply } from "../../permission/types.js";
import type { I18nKey } from "../../i18n/en.js";
import { t } from "../../i18n/index.js";
import { sendMessageWithMarkdownFallback } from "../utils/send-with-markdown-fallback.js";
import { getScopeFromContext, getScopeKeyFromContext, getThreadSendOptions } from "../scope.js";

const PERMISSION_CALLBACK = {
  PREFIX: "permission:",
  SEPARATOR: ":",
  ACTION_INDEX: 1,
  REQUEST_ID_INDEX: 2,
} as const;

type PermissionCallbackAction = PermissionReply;

interface ParsedPermissionCallback {
  action: PermissionCallbackAction;
  requestIDFromPayload: string | null;
}

interface ResolvedPermissionRequest {
  messageId: number | null;
  request: PermissionRequest;
}

// Permission type display names
const PERMISSION_NAME_KEYS: Record<string, I18nKey> = {
  bash: "permission.name.bash",
  edit: "permission.name.edit",
  write: "permission.name.write",
  read: "permission.name.read",
  webfetch: "permission.name.webfetch",
  websearch: "permission.name.websearch",
  glob: "permission.name.glob",
  grep: "permission.name.grep",
  list: "permission.name.list",
  task: "permission.name.task",
  lsp: "permission.name.lsp",
};

// Permission type emojis
const PERMISSION_EMOJIS: Record<string, string> = {
  bash: "⚡",
  edit: "✏️",
  write: "📝",
  read: "📖",
  webfetch: "🌐",
  websearch: "🔍",
  glob: "📁",
  grep: "🔎",
  list: "📂",
  task: "⚙️",
  lsp: "🔧",
};

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

function clearPermissionInteraction(reason: string, scopeKey: string): void {
  const state = interactionManager.getSnapshot(scopeKey);
  if (state?.kind === "permission") {
    interactionManager.clear(reason, scopeKey);
  }
}

function syncPermissionInteractionState(
  scopeKey: string,
  metadata: Record<string, unknown> = {},
): void {
  const pendingCount = permissionManager.getPendingCount(scopeKey);

  if (pendingCount === 0) {
    clearPermissionInteraction(INTERACTION_CLEAR_REASON.PERMISSION_NO_PENDING_REQUESTS, scopeKey);
    return;
  }

  const nextMetadata: Record<string, unknown> = {
    pendingCount,
    ...metadata,
  };

  const state = interactionManager.getSnapshot(scopeKey);
  if (state?.kind === "permission") {
    interactionManager.transition(
      {
        expectedInput: "callback",
        metadata: nextMetadata,
      },
      scopeKey,
    );
    return;
  }

  interactionManager.start(
    {
      kind: "permission",
      expectedInput: "callback",
      metadata: nextMetadata,
    },
    scopeKey,
  );
}

function isPermissionReply(value: string): value is PermissionReply {
  return value === "once" || value === "always" || value === "reject";
}

function parsePermissionCallback(data: string): ParsedPermissionCallback | null {
  if (!data.startsWith(PERMISSION_CALLBACK.PREFIX)) {
    return null;
  }

  const parts = data.split(PERMISSION_CALLBACK.SEPARATOR);
  const action = parts[PERMISSION_CALLBACK.ACTION_INDEX] ?? "";
  if (!isPermissionReply(action)) {
    return null;
  }

  const payloadRequestID = parts[PERMISSION_CALLBACK.REQUEST_ID_INDEX] ?? "";
  const requestIDFromPayload = payloadRequestID.length > 0 ? payloadRequestID : null;

  return {
    action,
    requestIDFromPayload,
  };
}

function resolvePermissionRequest(
  messageId: number | null,
  requestIDFromPayload: string | null,
  scopeKey: string,
): ResolvedPermissionRequest | null {
  const requestByMessageId = permissionManager.getRequest(messageId, scopeKey);
  if (requestByMessageId) {
    return {
      messageId,
      request: requestByMessageId,
    };
  }

  if (!requestIDFromPayload) {
    return null;
  }

  const matchByID = permissionManager.getRequestByID(requestIDFromPayload, scopeKey);
  if (!matchByID) {
    return null;
  }

  return {
    messageId: matchByID.messageId,
    request: matchByID.request,
  };
}

/**
 * Handle permission callback from inline buttons
 */
export async function handlePermissionCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data) return false;

  const parsedCallback = parsePermissionCallback(data);
  if (!parsedCallback) {
    return false;
  }

  logger.debug(`[PermissionHandler] Received callback: ${data}`);
  const scopeKey = getScopeKeyFromContext(ctx);

  if (!permissionManager.isActive(scopeKey)) {
    clearPermissionInteraction(INTERACTION_CLEAR_REASON.PERMISSION_INACTIVE_CALLBACK, scopeKey);
    await ctx.answerCallbackQuery({ text: t("permission.inactive_callback"), show_alert: true });
    return true;
  }

  const callbackMessageId = getCallbackMessageId(ctx);
  const resolvedRequest = resolvePermissionRequest(
    callbackMessageId,
    parsedCallback.requestIDFromPayload,
    scopeKey,
  );
  if (!resolvedRequest) {
    await ctx.answerCallbackQuery({ text: t("permission.inactive_callback"), show_alert: true });
    return true;
  }

  try {
    await handlePermissionReply(ctx, parsedCallback.action, resolvedRequest, scopeKey);
  } catch (err) {
    logger.error("[PermissionHandler] Error handling callback:", err);
    await ctx.answerCallbackQuery({
      text: t("permission.processing_error_callback"),
      show_alert: true,
    });
  }

  return true;
}

/**
 * Handle permission reply (once/always/reject)
 */
async function handlePermissionReply(
  ctx: Context,
  reply: PermissionReply,
  resolvedRequest: ResolvedPermissionRequest,
  scopeKey: string,
): Promise<void> {
  const { request, messageId: callbackMessageId } = resolvedRequest;
  const requestID = request.id;
  const currentProject = getCurrentProject(scopeKey);
  const currentSession = getCurrentSession(scopeKey);
  const cachedSession = getSessionById(request.sessionID);
  const chatId = ctx.chat?.id;
  const threadId = getScopeFromContext(ctx)?.threadId ?? null;
  const directory =
    (currentSession?.id === request.sessionID ? currentSession.directory : null) ??
    cachedSession?.directory ??
    currentProject?.worktree;

  if (!directory || !chatId) {
    permissionManager.clear(scopeKey);
    clearPermissionInteraction(
      INTERACTION_CLEAR_REASON.PERMISSION_INVALID_RUNTIME_CONTEXT,
      scopeKey,
    );

    await ctx.answerCallbackQuery({
      text: t("permission.no_active_request_callback"),
      show_alert: true,
    });
    return;
  }

  // Reply labels for user feedback
  const replyLabels: Record<PermissionReply, string> = {
    once: t("permission.reply.once"),
    always: t("permission.reply.always"),
    reject: t("permission.reply.reject"),
  };

  await ctx.answerCallbackQuery({ text: replyLabels[reply] });

  // Stop typing indicator since we're responding
  summaryAggregator.stopTypingIndicator(request.sessionID);

  logger.info(`[PermissionHandler] Sending permission reply: ${reply}, requestID=${requestID}`);

  const { error } = await opencodeClient.permission.reply({
    requestID,
    directory,
    reply,
  });

  if (error) {
    logger.error("[PermissionHandler] Failed to send permission reply:", error);
    if (ctx.api) {
      await ctx.api
        .sendMessage(chatId, t("permission.send_reply_error"), getThreadSendOptions(threadId))
        .catch(() => {});
    }
    return;
  }

  logger.info("[PermissionHandler] Permission reply sent successfully");

  // Delete the permission message only after successful reply
  await ctx.deleteMessage().catch(() => {});

  permissionManager.removeByMessageId(callbackMessageId, scopeKey);

  if (!permissionManager.isActive(scopeKey)) {
    clearPermissionInteraction(INTERACTION_CLEAR_REASON.PERMISSION_REPLIED, scopeKey);
    return;
  }

  syncPermissionInteractionState(scopeKey, {
    lastRepliedRequestID: requestID,
  });
}

/**
 * Show permission request message with inline buttons
 */
export async function showPermissionRequest(
  bot: Context["api"],
  chatId: number,
  request: PermissionRequest,
  scopeKey: string,
  threadId: number | null,
): Promise<void> {
  logger.debug(`[PermissionHandler] Showing permission request: ${request.permission}`);

  const text = formatPermissionText(request);
  const keyboard = buildPermissionKeyboard(request.id);

  try {
    const message = await sendMessageWithMarkdownFallback({
      api: bot,
      chatId,
      text,
      options: {
        reply_markup: keyboard,
        ...getThreadSendOptions(threadId),
      },
      parseMode: "Markdown",
    });

    logger.debug(`[PermissionHandler] Message sent, messageId=${message.message_id}`);
    permissionManager.startPermission(request, message.message_id, scopeKey);

    syncPermissionInteractionState(scopeKey, {
      requestID: request.id,
      messageId: message.message_id,
    });

    summaryAggregator.stopTypingIndicator(request.sessionID);
  } catch (err) {
    logger.error("[PermissionHandler] Failed to send permission message:", err);
    throw err;
  }
}

/**
 * Format permission request text
 */
function formatPermissionText(request: PermissionRequest): string {
  const emoji = PERMISSION_EMOJIS[request.permission] || "🔐";
  const nameKey = PERMISSION_NAME_KEYS[request.permission];
  const name = nameKey ? t(nameKey) : request.permission;

  let text = t("permission.header", { emoji, name });

  // Show patterns (commands/files)
  if (request.patterns.length > 0) {
    request.patterns.forEach((pattern) => {
      // Escape backticks for Markdown code
      const escapedPattern = pattern.replace(/`/g, "\\`");
      text += `\`${escapedPattern}\`\n`;
    });
  }

  return text;
}

/**
 * Build inline keyboard with permission buttons
 */
function buildPermissionKeyboard(requestID: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  keyboard
    .text(
      t("permission.button.allow"),
      `${PERMISSION_CALLBACK.PREFIX}once${PERMISSION_CALLBACK.SEPARATOR}${requestID}`,
    )
    .row();
  keyboard
    .text(
      t("permission.button.always"),
      `${PERMISSION_CALLBACK.PREFIX}always${PERMISSION_CALLBACK.SEPARATOR}${requestID}`,
    )
    .row();
  keyboard.text(
    t("permission.button.reject"),
    `${PERMISSION_CALLBACK.PREFIX}reject${PERMISSION_CALLBACK.SEPARATOR}${requestID}`,
  );

  return keyboard;
}
