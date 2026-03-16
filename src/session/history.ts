import { opencodeClient } from "../opencode/client.js";
import { logger } from "../utils/logger.js";

export type SessionHistoryItem = {
  role: "user" | "assistant";
  text: string;
  created: number;
};

type SessionMessagePart = {
  type: string;
  text?: string;
};

type SessionMessageInfo = {
  role?: string;
  summary?: boolean;
  time?: {
    created?: number;
  };
};

const DEFAULT_HISTORY_SCAN_LIMIT = 50;

function extractTextParts(parts: SessionMessagePart[]): string | null {
  const textParts = parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string);

  if (textParts.length === 0) {
    return null;
  }

  const text = textParts.join("").trim();
  return text.length > 0 ? text : null;
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const clipped = text.slice(0, Math.max(0, maxLength - 3)).trimEnd();
  return `${clipped}...`;
}

export async function loadSessionHistoryItems(
  sessionId: string,
  directory: string,
  limit: number = DEFAULT_HISTORY_SCAN_LIMIT,
): Promise<SessionHistoryItem[]> {
  try {
    const { data: messages, error } = await opencodeClient.session.messages({
      sessionID: sessionId,
      directory,
      limit,
    });

    if (error || !messages) {
      logger.warn("[SessionHistory] Failed to fetch session messages:", error);
      return [];
    }

    return messages
      .map(({ info, parts }) => {
        const messageInfo = info as SessionMessageInfo;
        const role = messageInfo.role as "user" | "assistant" | undefined;
        if (role !== "user" && role !== "assistant") {
          return null;
        }

        if (role === "assistant" && messageInfo.summary) {
          return null;
        }

        const text = extractTextParts(parts as SessionMessagePart[]);
        if (!text) {
          return null;
        }

        return {
          role,
          text,
          created: messageInfo.time?.created ?? 0,
        } satisfies SessionHistoryItem;
      })
      .filter((item): item is SessionHistoryItem => Boolean(item));
  } catch (err) {
    logger.error("[SessionHistory] Error loading session history:", err);
    return [];
  }
}

export async function loadLastAssistantMessage(
  sessionId: string,
  directory: string,
): Promise<SessionHistoryItem | null> {
  const items = await loadSessionHistoryItems(sessionId, directory);
  return items.find((item) => item.role === "assistant") ?? null;
}

export async function loadLastVisibleTurn(
  sessionId: string,
  directory: string,
): Promise<SessionHistoryItem | null> {
  const items = await loadSessionHistoryItems(sessionId, directory);
  return items[0] ?? null;
}
