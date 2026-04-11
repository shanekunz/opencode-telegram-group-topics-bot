import type { Context } from "grammy";
import { getStoredAgent, resolveProjectAgent } from "../../agent/manager.js";
import { clearAllInteractionState } from "../../interaction/cleanup.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { getStoredModel } from "../../model/manager.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { clearSession } from "../../session/manager.js";
import type { ProjectInfo } from "../../settings/manager.js";
import { setCurrentProject } from "../../settings/manager.js";
import { formatVariantForButton } from "../../variant/manager.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { SCOPE_CONTEXT, getScopeFromKey } from "../scope.js";
import { createMainKeyboard } from "./keyboard.js";

export async function switchToProject(
  ctx: Context,
  project: ProjectInfo,
  scopeKey: string,
  reason: string,
) {
  const usePinned = ctx.chat?.type !== "private";

  setCurrentProject(project, scopeKey);
  clearSession(scopeKey);
  clearAllInteractionState(reason, scopeKey);

  if (usePinned) {
    try {
      await pinnedMessageManager.clear(scopeKey);
    } catch (error) {
      logger.error("[Bot] Error clearing pinned message:", error);
    }
  }

  if (ctx.chat) {
    keyboardManager.initialize(ctx.api, ctx.chat.id, scopeKey);
  }

  if (usePinned) {
    await pinnedMessageManager.refreshContextLimit(scopeKey);
  }

  const contextLimit = usePinned ? pinnedMessageManager.getContextLimit(scopeKey) : 0;

  if (contextLimit > 0) {
    keyboardManager.updateContext(0, contextLimit, scopeKey);
  } else {
    keyboardManager.clearContext(scopeKey);
  }

  const currentAgent = await resolveProjectAgent(getStoredAgent(scopeKey), scopeKey);
  const currentModel = getStoredModel(scopeKey);
  const variantName = formatVariantForButton(currentModel.variant || "default");

  keyboardManager.updateAgent(currentAgent, scopeKey);

  const scope = getScopeFromKey(scopeKey);

  return createMainKeyboard(
    currentAgent,
    currentModel,
    { tokensUsed: 0, tokensLimit: contextLimit },
    variantName,
    scope?.context === SCOPE_CONTEXT.GROUP_GENERAL
      ? {
          contextFirst: true,
          contextLabel: t("keyboard.general_defaults"),
        }
      : undefined,
  );
}
