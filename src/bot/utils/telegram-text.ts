import type { Api, RawApi } from "grammy";
import {
  editMessageWithMarkdownFallback,
  sendMessageWithMarkdownFallback,
} from "./send-with-markdown-fallback.js";
import type { TelegramRenderedPart } from "../../telegram/render/types.js";

type SendMessageApi = Pick<Api<RawApi>, "sendMessage">;
type EditMessageApi = Pick<Api<RawApi>, "editMessageText">;

type TelegramSendMessageOptions = Parameters<SendMessageApi["sendMessage"]>[2];
type TelegramEditMessageOptions = Parameters<EditMessageApi["editMessageText"]>[3];

export type TelegramTextFormat = "raw" | "markdown_v2";

interface SendBotTextParams {
  api: SendMessageApi;
  chatId: Parameters<SendMessageApi["sendMessage"]>[0];
  text: string;
  rawFallbackText?: string;
  options?: TelegramSendMessageOptions;
  format?: TelegramTextFormat;
}

interface EditBotTextParams {
  api: EditMessageApi;
  chatId: Parameters<EditMessageApi["editMessageText"]>[0];
  messageId: Parameters<EditMessageApi["editMessageText"]>[1];
  text: string;
  rawFallbackText?: string;
  options?: TelegramEditMessageOptions;
  format?: TelegramTextFormat;
}

function resolveParseMode(format: TelegramTextFormat | undefined): "MarkdownV2" | undefined {
  if (format === "markdown_v2") {
    return "MarkdownV2";
  }

  return undefined;
}

export async function sendBotText({
  api,
  chatId,
  text,
  rawFallbackText,
  options,
  format = "raw",
}: SendBotTextParams): Promise<Awaited<ReturnType<SendMessageApi["sendMessage"]>>> {
  return await sendMessageWithMarkdownFallback({
    api,
    chatId,
    text,
    rawFallbackText,
    options,
    parseMode: resolveParseMode(format),
  });
}

export async function editBotText({
  api,
  chatId,
  messageId,
  text,
  rawFallbackText,
  options,
  format = "raw",
}: EditBotTextParams): Promise<Awaited<ReturnType<EditMessageApi["editMessageText"]>>> {
  return await editMessageWithMarkdownFallback({
    api,
    chatId,
    messageId,
    text,
    rawFallbackText,
    options,
    parseMode: resolveParseMode(format),
  });
}

interface SendRenderedPartParams {
  api: SendMessageApi;
  chatId: Parameters<SendMessageApi["sendMessage"]>[0];
  part: TelegramRenderedPart;
  options?: TelegramSendMessageOptions;
}

interface EditRenderedPartParams {
  api: EditMessageApi;
  chatId: Parameters<EditMessageApi["editMessageText"]>[0];
  messageId: Parameters<EditMessageApi["editMessageText"]>[1];
  part: TelegramRenderedPart;
  options?: TelegramEditMessageOptions;
}

export async function sendBotRenderedPart({
  api,
  chatId,
  part,
  options,
}: SendRenderedPartParams): Promise<Awaited<ReturnType<SendMessageApi["sendMessage"]>>> {
  if (part.entities?.length) {
    try {
      return await api.sendMessage(chatId, part.text, {
        ...(options || {}),
        entities: part.entities,
      });
    } catch {
      return await api.sendMessage(chatId, part.fallbackText, options);
    }
  }

  return await api.sendMessage(chatId, part.text, options);
}

export async function editBotRenderedPart({
  api,
  chatId,
  messageId,
  part,
  options,
}: EditRenderedPartParams): Promise<Awaited<ReturnType<EditMessageApi["editMessageText"]>>> {
  if (part.entities?.length) {
    try {
      return await api.editMessageText(chatId, messageId, part.text, {
        ...(options || {}),
        entities: part.entities,
      });
    } catch {
      return await api.editMessageText(chatId, messageId, part.fallbackText, options);
    }
  }

  return await api.editMessageText(chatId, messageId, part.text, options);
}
