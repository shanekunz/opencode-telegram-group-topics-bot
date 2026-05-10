// @ts-expect-error node-fetch v2 ships no TS types in this setup
import nodeFetch from "node-fetch";
import { Agent as HttpsAgent } from "node:https";
import type { Bot, Context } from "grammy";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import type { TelegramConfig } from "../config.js";
import { logger } from "../utils/logger.js";

export type TelegramBotOptions = NonNullable<ConstructorParameters<typeof Bot<Context>>[1]>;

export function createTelegramIpv4Agent(): HttpsAgent {
  return new HttpsAgent({ family: 4, keepAlive: true });
}

export function createTelegramBotOptions(telegram: TelegramConfig): TelegramBotOptions {
  const botOptions: TelegramBotOptions = {};

  if (telegram.apiRoot || telegram.proxySecret) {
    botOptions.client = botOptions.client ?? {};

    if (telegram.apiRoot) {
      botOptions.client.apiRoot = telegram.apiRoot;
      logger.info(`[Bot] Using custom Telegram API root: ${telegram.apiRoot}`);
    }

    if (telegram.proxySecret) {
      const proxySecret = telegram.proxySecret;
      botOptions.client.fetch = (((url: unknown, init: Record<string, unknown> | undefined) => {
        const existingHeaders = (init?.headers as Record<string, string> | undefined) ?? {};
        const mergedHeaders = { ...existingHeaders, "X-Proxy-Secret": proxySecret };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (nodeFetch as any)(url, { ...(init ?? {}), headers: mergedHeaders });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any);
      logger.info("[Bot] Sending X-Proxy-Secret header to Telegram API root");
    }
  }

  if (telegram.proxyUrl) {
    const proxyUrl = telegram.proxyUrl;
    const agent = proxyUrl.startsWith("socks")
      ? new SocksProxyAgent(proxyUrl)
      : new HttpsProxyAgent(proxyUrl);

    logger.info(
      proxyUrl.startsWith("socks")
        ? `[Bot] Using SOCKS proxy: ${proxyUrl.replace(/\/\/.*@/, "//***@")}`
        : `[Bot] Using HTTP/HTTPS proxy: ${proxyUrl.replace(/\/\/.*@/, "//***@")}`,
    );

    botOptions.client = botOptions.client ?? {};
    botOptions.client.baseFetchConfig = {
      ...(botOptions.client.baseFetchConfig ?? {}),
      agent,
      compress: true,
    };
  } else if (telegram.forceIpv4) {
    botOptions.client = botOptions.client ?? {};
    botOptions.client.baseFetchConfig = {
      ...(botOptions.client.baseFetchConfig ?? {}),
      agent: createTelegramIpv4Agent(),
      compress: true,
    };
    logger.info("[Bot] Forcing IPv4 for Telegram API requests");
  }

  return botOptions;
}
