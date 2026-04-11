import { Context, InlineKeyboard } from "grammy";
import { interactionManager } from "../../interaction/manager.js";
import type { InteractionState } from "../../interaction/types.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { getScopeFromContext, getScopeKeyFromContext, getThreadSendOptions } from "../scope.js";

const INLINE_MENU_CANCEL_PREFIX = "inline:cancel:";
const LEGACY_CONTEXT_CANCEL_CALLBACK = "compact:cancel";

const INLINE_MENU_KINDS = [
  "project",
  "open",
  "session",
  "model",
  "agent",
  "variant",
  "context",
  "tasklist",
] as const;

export type InlineMenuKind = (typeof INLINE_MENU_KINDS)[number];

interface ActiveInlineMenuMetadata {
  menuKind: InlineMenuKind;
  messageId: number;
}

interface SuspendedTaskInteractionMetadata {
  stage: string;
  allowedCommands: string[];
}

interface InlineMenuReplyOptions {
  menuKind: InlineMenuKind;
  text: string;
  keyboard: InlineKeyboard;
  parseMode?: "Markdown" | "HTML";
}

function isInlineMenuKind(value: string): value is InlineMenuKind {
  return INLINE_MENU_KINDS.includes(value as InlineMenuKind);
}

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

function getActiveInlineMenuMetadata(
  state: InteractionState | null,
): ActiveInlineMenuMetadata | null {
  if (!state || state.kind !== "inline") {
    return null;
  }

  const menuKind = state.metadata.menuKind;
  const messageId = state.metadata.messageId;

  if (typeof menuKind !== "string" || !isInlineMenuKind(menuKind)) {
    return null;
  }

  if (typeof messageId !== "number") {
    return null;
  }

  return {
    menuKind,
    messageId,
  };
}

function getInlineCancelCallbackData(menuKind: InlineMenuKind): string {
  return `${INLINE_MENU_CANCEL_PREFIX}${menuKind}`;
}

function getSuspendedTaskInteractionMetadata(
  state: InteractionState | null,
): SuspendedTaskInteractionMetadata | null {
  if (state?.kind !== "task" || state.expectedInput !== "mixed") {
    return null;
  }

  const stage = state.metadata.stage;
  if (typeof stage !== "string") {
    return null;
  }

  return {
    stage,
    allowedCommands: [...state.allowedCommands],
  };
}

function restoreSuspendedInteraction(scopeKey: string, state: InteractionState | null): void {
  if (state?.kind !== "inline") {
    return;
  }

  const suspendedTaskStage = state.metadata.suspendedTaskStage;
  if (typeof suspendedTaskStage !== "string") {
    return;
  }

  const suspendedAllowedCommands = Array.isArray(state.metadata.suspendedAllowedCommands)
    ? state.metadata.suspendedAllowedCommands.filter(
        (value): value is string => typeof value === "string",
      )
    : undefined;

  interactionManager.start(
    {
      kind: "task",
      expectedInput: "mixed",
      allowedCommands: suspendedAllowedCommands,
      metadata: { stage: suspendedTaskStage },
    },
    scopeKey,
  );
}

export function appendInlineMenuCancelButton(
  keyboard: InlineKeyboard,
  menuKind: InlineMenuKind,
): InlineKeyboard {
  while (
    keyboard.inline_keyboard.length > 0 &&
    keyboard.inline_keyboard[keyboard.inline_keyboard.length - 1].length === 0
  ) {
    keyboard.inline_keyboard.pop();
  }

  if (keyboard.inline_keyboard.length > 0) {
    keyboard.row();
  }

  keyboard.text(t("inline.button.cancel"), getInlineCancelCallbackData(menuKind));
  return keyboard;
}

export async function replyWithInlineMenu(
  ctx: Context,
  options: InlineMenuReplyOptions,
): Promise<number> {
  const scope = getScopeFromContext(ctx);
  const scopeKey = scope?.key ?? getScopeKeyFromContext(ctx);
  const suspendedTaskInteraction = getSuspendedTaskInteractionMetadata(
    interactionManager.getSnapshot(scopeKey),
  );
  const keyboard = appendInlineMenuCancelButton(options.keyboard, options.menuKind);
  const replyOptions: {
    reply_markup: InlineKeyboard;
    parse_mode?: "Markdown" | "HTML";
    message_thread_id?: number;
  } = {
    reply_markup: keyboard,
    ...getThreadSendOptions(scope?.threadId ?? null),
  };

  if (options.parseMode) {
    replyOptions.parse_mode = options.parseMode;
  }

  const message = await ctx.reply(options.text, replyOptions);

  interactionManager.start(
    {
      kind: "inline",
      expectedInput: "callback",
      metadata: {
        menuKind: options.menuKind,
        messageId: message.message_id,
        ...(suspendedTaskInteraction
          ? {
              suspendedTaskStage: suspendedTaskInteraction.stage,
              suspendedAllowedCommands: suspendedTaskInteraction.allowedCommands,
            }
          : {}),
      },
    },
    scopeKey,
  );

  logger.debug(
    `[InlineMenu] Opened menu: kind=${options.menuKind}, messageId=${message.message_id}`,
  );

  return message.message_id;
}

export async function ensureActiveInlineMenu(
  ctx: Context,
  menuKind: InlineMenuKind,
): Promise<boolean> {
  const scopeKey = getScopeKeyFromContext(ctx);
  const activeMetadata = getActiveInlineMenuMetadata(interactionManager.getSnapshot(scopeKey));
  const callbackMessageId = getCallbackMessageId(ctx);

  const isActive =
    !!activeMetadata &&
    callbackMessageId !== null &&
    activeMetadata.menuKind === menuKind &&
    activeMetadata.messageId === callbackMessageId;

  if (isActive) {
    return true;
  }

  logger.debug(
    `[InlineMenu] Stale callback ignored: expectedKind=${menuKind}, activeKind=${activeMetadata?.menuKind || "none"}, callbackMessageId=${callbackMessageId || "none"}, activeMessageId=${activeMetadata?.messageId || "none"}`,
  );

  await ctx
    .answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true })
    .catch(() => {});

  return false;
}

export function clearActiveInlineMenu(reason: string, scopeKey: string = "global"): void {
  const state = interactionManager.getSnapshot(scopeKey);
  if (state?.kind === "inline") {
    restoreSuspendedInteraction(scopeKey, state);
    if (interactionManager.getSnapshot(scopeKey)?.kind === "inline") {
      interactionManager.clear(reason, scopeKey);
    }
  }
}

export async function handleInlineMenuCancel(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data) {
    return false;
  }

  let menuKind: InlineMenuKind | null = null;

  if (data === LEGACY_CONTEXT_CANCEL_CALLBACK) {
    menuKind = "context";
  } else if (data.startsWith(INLINE_MENU_CANCEL_PREFIX)) {
    const rawKind = data.slice(INLINE_MENU_CANCEL_PREFIX.length);
    if (!isInlineMenuKind(rawKind)) {
      return false;
    }

    menuKind = rawKind;
  } else {
    return false;
  }

  const isActive = await ensureActiveInlineMenu(ctx, menuKind);
  if (!isActive) {
    return true;
  }

  clearActiveInlineMenu(`inline_menu_cancel:${menuKind}`, getScopeKeyFromContext(ctx));

  await ctx.answerCallbackQuery({ text: t("inline.cancelled_callback") }).catch(() => {});
  await ctx.deleteMessage().catch(() => {});

  logger.debug(`[InlineMenu] Menu cancelled: kind=${menuKind}`);

  return true;
}
