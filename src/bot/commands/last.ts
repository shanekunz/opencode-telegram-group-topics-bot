import { CommandContext, Context } from "grammy";
import { getCurrentProject } from "../../settings/manager.js";
import { getCurrentSession } from "../../session/manager.js";
import { questionManager } from "../../question/manager.js";
import {
  loadLastAssistantMessage,
  loadLastVisibleTurn,
  truncateText,
} from "../../session/history.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { getScopeFromContext, getScopeKeyFromContext, getThreadSendOptions } from "../scope.js";
import { showCurrentQuestion } from "../handlers/question.js";

const LAST_MESSAGE_MAX_LENGTH = 3500;

function formatLastMessage(role: "user" | "assistant", text: string): string {
  const title = t("last.title");
  const label = role === "user" ? t("sessions.preview.you") : t("sessions.preview.agent");
  return `${title}\n\n${label} ${truncateText(text, LAST_MESSAGE_MAX_LENGTH)}`;
}

export async function lastCommand(ctx: CommandContext<Context>): Promise<void> {
  try {
    const scopeKey = getScopeKeyFromContext(ctx);
    const scope = getScopeFromContext(ctx);
    const sendOptions = getThreadSendOptions(scope?.threadId ?? null);

    if (
      questionManager.isActive(scopeKey) &&
      questionManager.getActiveMessageId(scopeKey) === null
    ) {
      await showCurrentQuestion(ctx.api, ctx.chat!.id, scopeKey, scope?.threadId ?? null);
      return;
    }

    const currentProject = getCurrentProject(scopeKey);
    if (!currentProject) {
      await ctx.reply(t("bot.project_not_selected"), sendOptions);
      return;
    }

    const currentSession = getCurrentSession(scopeKey);
    if (!currentSession) {
      await ctx.reply(t("last.session_not_selected"), sendOptions);
      return;
    }

    const lastVisibleTurn =
      (await loadLastAssistantMessage(currentSession.id, currentSession.directory)) ??
      (await loadLastVisibleTurn(currentSession.id, currentSession.directory));
    if (!lastVisibleTurn) {
      await ctx.reply(t("last.empty"), sendOptions);
      return;
    }

    await ctx.reply(formatLastMessage(lastVisibleTurn.role, lastVisibleTurn.text), sendOptions);
  } catch (error) {
    logger.error("[Last] Error loading latest session message:", error);
    const scope = getScopeFromContext(ctx);
    await ctx.reply(t("last.fetch_error"), getThreadSendOptions(scope?.threadId ?? null));
  }
}
