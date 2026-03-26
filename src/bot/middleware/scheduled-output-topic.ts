import type { Context, NextFunction } from "grammy";
import { getScheduledTaskTopicByChatAndThread } from "../../scheduled-task/store.js";
import { extractCommandName } from "../utils/commands.js";
import { t } from "../../i18n/index.js";
import { CHAT_TYPE } from "../constants.js";
import { getScopeFromContext, getThreadSendOptions, SCOPE_CONTEXT } from "../scope.js";
import { BOT_COMMAND } from "../commands/constants.js";

const ALLOWED_COMMANDS = new Set<string>([BOT_COMMAND.START, BOT_COMMAND.HELP]);

export async function isScheduledTaskOutputTopicContext(ctx: Context): Promise<boolean> {
  if (ctx.chat?.type === CHAT_TYPE.PRIVATE) {
    return false;
  }

  const scope = getScopeFromContext(ctx);
  if (
    scope?.context !== SCOPE_CONTEXT.GROUP_TOPIC ||
    typeof scope.threadId !== "number" ||
    !ctx.chat
  ) {
    return false;
  }

  const binding = await getScheduledTaskTopicByChatAndThread(ctx.chat.id, scope.threadId);
  return Boolean(binding);
}

export async function scheduledOutputTopicMiddleware(
  ctx: Context,
  next: NextFunction,
): Promise<void> {
  const text = ctx.message?.text;
  if (!text) {
    await next();
    return;
  }

  const commandName = extractCommandName(text);
  if (!commandName) {
    await next();
    return;
  }

  if (!(await isScheduledTaskOutputTopicContext(ctx))) {
    await next();
    return;
  }

  if (ALLOWED_COMMANDS.has(commandName)) {
    await next();
    return;
  }

  const scope = getScopeFromContext(ctx);
  await ctx.reply(
    t("task.output_topic_commands_only"),
    getThreadSendOptions(scope?.threadId ?? null),
  );
}
