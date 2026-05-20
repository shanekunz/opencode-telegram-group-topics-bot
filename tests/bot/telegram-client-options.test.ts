import { Agent as HttpsAgent } from "node:https";
import { describe, expect, it, vi } from "vitest";
import { createTelegramBotOptions } from "../../src/bot/telegram-client-options.js";

function makeTelegramConfig(overrides: Partial<Parameters<typeof createTelegramBotOptions>[0]> = {}) {
  return {
    apiRoot: "",
    proxySecret: "",
    proxyUrl: "",
    forceIpv4: false,
    ...overrides,
  };
}

describe("createTelegramBotOptions", () => {
  it("does not configure an agent for direct Telegram API requests by default", () => {
    const options = createTelegramBotOptions(makeTelegramConfig());

    expect(options.client).toBeUndefined();
  });

  it("configures an IPv4 HTTPS agent for direct Telegram API requests when enabled", () => {
    const options = createTelegramBotOptions(makeTelegramConfig({ forceIpv4: true }));
    const agent = options.client?.baseFetchConfig?.agent;

    expect(agent).toBeInstanceOf(HttpsAgent);
    expect((agent as HttpsAgent).options.family).toBe(4);
    expect(options.client?.baseFetchConfig?.compress).toBe(true);
  });

  it("keeps reverse-proxy options when IPv4 mode is enabled", () => {
    const options = createTelegramBotOptions(
      makeTelegramConfig({
        apiRoot: "https://tg-proxy.example.com",
        proxySecret: "secret-abc",
        forceIpv4: true,
      }),
    );

    expect(options.client?.apiRoot).toBe("https://tg-proxy.example.com");
    expect(options.client?.fetch).toBeTypeOf("function");
    expect(options.client?.baseFetchConfig?.agent).toBeInstanceOf(HttpsAgent);
  });

  it("injects X-Proxy-Secret into custom Telegram fetches", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const options = createTelegramBotOptions(
      makeTelegramConfig({
        apiRoot: "https://tg-proxy.example.com",
        proxySecret: "secret-abc",
      }),
    );

    await options.client?.fetch?.("https://tg-proxy.example.com/botTOKEN/getMe", {
      headers: { "Content-Type": "application/json" },
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(new Headers((init as RequestInit | undefined)?.headers).get("X-Proxy-Secret")).toBe(
      "secret-abc",
    );
  });
});
