import { CommandContext, Context } from "grammy";
import { isTtsConfigured } from "../../tts/client.js";
import { isTtsEnabled, setTtsEnabled } from "../../settings/manager.js";
import { t } from "../../i18n/index.js";
import { getScopeFromContext, getThreadSendOptions } from "../scope.js";

export async function ttsCommand(ctx: CommandContext<Context>): Promise<void> {
  const scope = getScopeFromContext(ctx);
  const enabled = !isTtsEnabled();

  setTtsEnabled(enabled);

  const message = enabled
    ? isTtsConfigured()
      ? t("tts.enabled")
      : t("tts.enabled_not_configured")
    : t("tts.disabled");

  await ctx.reply(message, getThreadSendOptions(scope?.threadId ?? null));
}
