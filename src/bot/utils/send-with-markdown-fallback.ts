import { logger } from "../../utils/logger.js";
import type { Api, RawApi } from "grammy";

type SendMessageApi = Pick<Api<RawApi>, "sendMessage">;
type EditMessageApi = Pick<Api<RawApi>, "editMessageText">;
type TelegramSendMessageOptions = Parameters<SendMessageApi["sendMessage"]>[2];
type TelegramEditMessageOptions = Parameters<EditMessageApi["editMessageText"]>[3];

interface SendMessageWithMarkdownFallbackParams {
  api: SendMessageApi;
  chatId: Parameters<SendMessageApi["sendMessage"]>[0];
  text: string;
  options?: TelegramSendMessageOptions;
  parseMode?: "Markdown" | "MarkdownV2";
}

interface EditMessageWithMarkdownFallbackParams {
  api: EditMessageApi;
  chatId: Parameters<EditMessageApi["editMessageText"]>[0];
  messageId: Parameters<EditMessageApi["editMessageText"]>[1];
  text: string;
  options?: TelegramEditMessageOptions;
  parseMode?: "Markdown" | "MarkdownV2";
}

const MARKDOWN_PARSE_ERROR_MARKERS = [
  "can't parse entities",
  "can't parse entity",
  "can't find end of the entity",
  "entity beginning",
  "bad request: can't parse",
];

const MESSAGE_NOT_MODIFIED_MARKER = "message is not modified";

function stripMarkdownFormattingOptions<
  T extends TelegramSendMessageOptions | TelegramEditMessageOptions | undefined,
>(options: T): T {
  if (!options) {
    return options;
  }

  const rawOptions = {
    ...options,
  } as NonNullable<T> & {
    parse_mode?: unknown;
    entities?: unknown;
  };

  delete rawOptions.parse_mode;
  delete rawOptions.entities;

  return rawOptions as T;
}

function getErrorText(error: unknown): string {
  const parts: string[] = [];

  if (error instanceof Error) {
    parts.push(error.message);
  }

  if (typeof error === "object" && error !== null) {
    const description = Reflect.get(error, "description");
    if (typeof description === "string") {
      parts.push(description);
    }

    const message = Reflect.get(error, "message");
    if (typeof message === "string") {
      parts.push(message);
    }
  }

  if (typeof error === "string") {
    parts.push(error);
  }

  if (parts.length === 0) {
    return "";
  }

  return parts.join("\n").toLowerCase();
}

export function isTelegramMarkdownParseError(error: unknown): boolean {
  const errorText = getErrorText(error);
  if (!errorText) {
    return false;
  }

  return MARKDOWN_PARSE_ERROR_MARKERS.some((marker) => errorText.includes(marker));
}

export function isTelegramMessageNotModifiedError(error: unknown): boolean {
  const errorText = getErrorText(error);
  if (!errorText) {
    return false;
  }

  return errorText.includes(MESSAGE_NOT_MODIFIED_MARKER);
}

export function getTelegramRetryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const params = Reflect.get(error, "parameters");
  if (!params || typeof params !== "object") {
    return null;
  }

  const retryAfter = Reflect.get(params, "retry_after");
  if (typeof retryAfter !== "number" || retryAfter <= 0) {
    return null;
  }

  return retryAfter * 1000;
}

export async function sendMessageWithMarkdownFallback({
  api,
  chatId,
  text,
  options,
  parseMode,
}: SendMessageWithMarkdownFallbackParams): Promise<
  Awaited<ReturnType<SendMessageApi["sendMessage"]>>
> {
  if (!parseMode) {
    return await api.sendMessage(chatId, text, options);
  }

  const markdownOptions: TelegramSendMessageOptions = {
    ...(options || {}),
    parse_mode: parseMode,
  };

  try {
    return await api.sendMessage(chatId, text, markdownOptions);
  } catch (error) {
    if (!isTelegramMarkdownParseError(error)) {
      throw error;
    }

    logger.debug("[Bot] Markdown parse failed, retrying assistant message in raw mode", error);
    return await api.sendMessage(chatId, text, stripMarkdownFormattingOptions(options));
  }
}

export async function editMessageWithMarkdownFallback({
  api,
  chatId,
  messageId,
  text,
  options,
  parseMode,
}: EditMessageWithMarkdownFallbackParams): Promise<
  Awaited<ReturnType<EditMessageApi["editMessageText"]>>
> {
  if (!parseMode) {
    return await api.editMessageText(chatId, messageId, text, options);
  }

  const markdownOptions: TelegramEditMessageOptions = {
    ...(options || {}),
    parse_mode: parseMode,
  };

  try {
    return await api.editMessageText(chatId, messageId, text, markdownOptions);
  } catch (error) {
    if (!isTelegramMarkdownParseError(error)) {
      throw error;
    }

    logger.debug("[Bot] Markdown parse failed, retrying edited message in raw mode", error);
    return await api.editMessageText(
      chatId,
      messageId,
      text,
      stripMarkdownFormattingOptions(options),
    );
  }
}
