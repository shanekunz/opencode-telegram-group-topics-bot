import { formatSummary, getAssistantParseMode } from "../../summary/formatter.js";
import type { TelegramTextFormat } from "./telegram-text.js";
import type { ResponseStreamer } from "../streaming/response-streamer.js";

interface FinalizeAssistantResponseParams {
  sessionId: string;
  messageText: string;
  responseStreamer: ResponseStreamer;
  sendFallback: (parts: string[], format: TelegramTextFormat) => Promise<void>;
}

export async function finalizeAssistantResponse({
  sessionId,
  messageText,
  responseStreamer,
  sendFallback,
}: FinalizeAssistantResponseParams): Promise<{ streamed: boolean; partCount: number }> {
  const assistantParseMode = getAssistantParseMode();
  const format: TelegramTextFormat = assistantParseMode === "MarkdownV2" ? "markdown_v2" : "raw";

  const replacedStreamedMessage = await responseStreamer.resetForFinalDelivery(sessionId);

  const parts = formatSummary(messageText);
  if (parts.length === 0) {
    return { streamed: replacedStreamedMessage, partCount: 0 };
  }

  await sendFallback(parts, format);
  return { streamed: replacedStreamedMessage, partCount: parts.length };
}
