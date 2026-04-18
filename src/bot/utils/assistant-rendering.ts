import { config } from "../../config.js";
import { logger } from "../../utils/logger.js";
import { chunkTelegramRenderedBlocks } from "../../telegram/render/chunker.js";
import { renderTelegramParts } from "../../telegram/render/pipeline.js";
import type { TelegramRenderedBlock, TelegramRenderedPart } from "../../telegram/render/types.js";

export function createPlainRenderedBlock(text: string): TelegramRenderedBlock {
  return {
    blockType: "plain",
    mode: "plain",
    text,
    fallbackText: text,
    source: "plain",
  };
}

export function createPlainRenderedParts(
  text: string,
  maxPartLength: number,
): TelegramRenderedPart[] {
  return chunkTelegramRenderedBlocks([createPlainRenderedBlock(text)], { maxPartLength });
}

function useAssistantEntitiesFormat(): boolean {
  return config.bot.messageFormatMode === "markdown";
}

export function renderAssistantFinalPartsSafe(
  text: string,
  maxPartLength = 4096,
): TelegramRenderedPart[] {
  if (!text) {
    return [];
  }

  if (!useAssistantEntitiesFormat()) {
    return createPlainRenderedParts(text, maxPartLength);
  }

  try {
    return renderTelegramParts(text, { maxPartLength });
  } catch (error) {
    logger.warn("[AssistantRender] Part rendering failed, falling back to plain text parts", error);
    return createPlainRenderedParts(text, maxPartLength);
  }
}
