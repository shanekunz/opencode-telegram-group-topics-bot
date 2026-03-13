import { logger } from "../../utils/logger.js";
import type { Api, RawApi } from "grammy";

type SendMessageApi = Pick<Api<RawApi>, "sendMessage">;
type TelegramSendMessageOptions = Parameters<SendMessageApi["sendMessage"]>[2];

interface SendMessageWithMarkdownFallbackParams {
  api: SendMessageApi;
  chatId: Parameters<SendMessageApi["sendMessage"]>[0];
  text: string;
  options?: TelegramSendMessageOptions;
  parseMode?: "Markdown" | "MarkdownV2";
}

const MARKDOWN_PARSE_ERROR_MARKERS = [
  "can't parse entities",
  "can't parse entity",
  "can't find end of the entity",
  "entity beginning",
  "bad request: can't parse",
];

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

    logger.warn("[Bot] Markdown parse failed, retrying assistant message in raw mode", error);
    return await api.sendMessage(chatId, text, options);
  }
}
