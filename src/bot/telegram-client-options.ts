import { Agent as HttpsAgent } from "node:https";
import type { Bot, Context } from "grammy";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { logger } from "../utils/logger.js";

export interface TelegramClientConfig {
  apiRoot: string;
  proxySecret: string;
  proxyUrl: string;
  forceIpv4: boolean;
}

export type TelegramBotOptions = NonNullable<ConstructorParameters<typeof Bot<Context>>[1]>;

export function createTelegramIpv4Agent(): HttpsAgent {
  return new HttpsAgent({ family: 4, keepAlive: true });
}

export function createTelegramBotOptions(telegram: TelegramClientConfig): TelegramBotOptions {
  const botOptions: TelegramBotOptions = {};

  if (telegram.apiRoot || telegram.proxySecret) {
    botOptions.client = botOptions.client ?? {};

    if (telegram.apiRoot) {
      botOptions.client.apiRoot = telegram.apiRoot;
      logger.info(`[Bot] Using custom Telegram API root: ${telegram.apiRoot}`);
    }

    if (telegram.proxySecret) {
      const proxySecret = telegram.proxySecret;
      botOptions.client.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const existingHeaders = new Headers(init?.headers);
        existingHeaders.set("X-Proxy-Secret", proxySecret);

        return await fetch(input, {
          ...(init || {}),
          headers: existingHeaders,
        });
      }) as typeof fetch;
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
      ...(botOptions.client.baseFetchConfig || {}),
      agent,
      compress: true,
    };
  } else if (telegram.forceIpv4) {
    botOptions.client = botOptions.client ?? {};
    botOptions.client.baseFetchConfig = {
      ...(botOptions.client.baseFetchConfig || {}),
      agent: createTelegramIpv4Agent(),
      compress: true,
    };
    logger.info("[Bot] Forcing IPv4 for Telegram API requests");
  }

  return botOptions;
}
