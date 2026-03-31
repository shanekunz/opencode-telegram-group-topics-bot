import { logger } from "../utils/logger.js";
import { getTopicBindingBySessionId, updateTopicBindingNameBySessionId } from "./manager.js";
import { formatTopicTitle } from "./title-format.js";
import { getTelegramRetryAfterMs } from "../bot/utils/send-with-markdown-fallback.js";

interface TopicEditApi {
  editForumTopic: (
    chatId: number,
    messageThreadId: number,
    payload: { name: string },
  ) => Promise<unknown>;
}

export async function syncTopicTitleForSession(
  api: TopicEditApi,
  sessionId: string,
  sessionTitle: string,
): Promise<boolean> {
  const binding = getTopicBindingBySessionId(sessionId);
  if (!binding) {
    return false;
  }

  const topicName = formatTopicTitle(sessionTitle);
  if (!topicName || binding.topicName === topicName) {
    return false;
  }

  while (true) {
    try {
      await api.editForumTopic(binding.chatId, binding.threadId, { name: topicName });
      break;
    } catch (error) {
      if (error instanceof Error && error.message.includes("TOPIC_NOT_MODIFIED")) {
        updateTopicBindingNameBySessionId(sessionId, topicName);
        return false;
      }

      const retryAfterMs = getTelegramRetryAfterMs(error);
      if (!retryAfterMs) {
        throw error;
      }

      logger.info(
        `[TopicTitle] Telegram rate limit; retrying topic title sync in ${retryAfterMs}ms`,
        {
          sessionId,
        },
      );
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs + 100));
    }
  }

  updateTopicBindingNameBySessionId(sessionId, topicName);

  logger.info(
    `[TopicTitle] Synced topic title for session ${sessionId}: thread=${binding.threadId}, title=${topicName}`,
  );

  return true;
}
