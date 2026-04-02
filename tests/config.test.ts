import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadConfig() {
  vi.resetModules();
  const module = await import("../src/config.js");
  return module.config;
}

describe("config boolean env parsing", () => {
  beforeEach(() => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-telegram-token");
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", "123456789");
    vi.stubEnv("OPENCODE_MODEL_PROVIDER", "test-provider");
    vi.stubEnv("OPENCODE_MODEL_ID", "test-model");
  });

  it("uses false defaults for hide service message flags", async () => {
    vi.stubEnv("HIDE_THINKING_MESSAGES", "");
    vi.stubEnv("HIDE_TOOL_CALL_MESSAGES", "");

    const config = await loadConfig();

    expect(config.bot.hideThinkingMessages).toBe(false);
    expect(config.bot.hideToolCallMessages).toBe(false);
  });

  it("parses truthy values for hide service message flags", async () => {
    vi.stubEnv("HIDE_THINKING_MESSAGES", "YES");
    vi.stubEnv("HIDE_TOOL_CALL_MESSAGES", "1");

    const config = await loadConfig();

    expect(config.bot.hideThinkingMessages).toBe(true);
    expect(config.bot.hideToolCallMessages).toBe(true);
  });

  it("parses falsy values for hide service message flags", async () => {
    vi.stubEnv("HIDE_THINKING_MESSAGES", "off");
    vi.stubEnv("HIDE_TOOL_CALL_MESSAGES", "0");

    const config = await loadConfig();

    expect(config.bot.hideThinkingMessages).toBe(false);
    expect(config.bot.hideToolCallMessages).toBe(false);
  });

  it("falls back to defaults on invalid values", async () => {
    vi.stubEnv("HIDE_THINKING_MESSAGES", "banana");
    vi.stubEnv("HIDE_TOOL_CALL_MESSAGES", "nope");

    const config = await loadConfig();

    expect(config.bot.hideThinkingMessages).toBe(false);
    expect(config.bot.hideToolCallMessages).toBe(false);
  });

  it("uses markdown as default message format mode", async () => {
    vi.stubEnv("MESSAGE_FORMAT_MODE", "");

    const config = await loadConfig();

    expect(config.bot.messageFormatMode).toBe("markdown");
  });

  it("parses markdown message format mode", async () => {
    vi.stubEnv("MESSAGE_FORMAT_MODE", "MARKDOWN");

    const config = await loadConfig();

    expect(config.bot.messageFormatMode).toBe("markdown");
  });

  it("falls back to markdown on invalid message format mode", async () => {
    vi.stubEnv("MESSAGE_FORMAT_MODE", "html");

    const config = await loadConfig();

    expect(config.bot.messageFormatMode).toBe("markdown");
  });

  it("parses supported locale from BOT_LOCALE", async () => {
    vi.stubEnv("BOT_LOCALE", "ru");

    const config = await loadConfig();

    expect(config.bot.locale).toBe("ru");
  });

  it("normalizes regional locale tags", async () => {
    vi.stubEnv("BOT_LOCALE", "ru-RU");

    const config = await loadConfig();

    expect(config.bot.locale).toBe("ru");
  });

  it("falls back to default locale on unsupported value", async () => {
    vi.stubEnv("BOT_LOCALE", "pt");

    const config = await loadConfig();

    expect(config.bot.locale).toBe("en");
  });

  it("accepts French locale from BOT_LOCALE", async () => {
    vi.stubEnv("BOT_LOCALE", "fr");

    const config = await loadConfig();

    expect(config.bot.locale).toBe("fr");
  });

  it("uses 30 seconds as default scheduled task poll interval", async () => {
    vi.stubEnv("SCHEDULED_TASK_POLL_INTERVAL_SEC", "");

    const config = await loadConfig();

    expect(config.bot.scheduledTasksPollIntervalSec).toBe(30);
  });

  it("uses 1000ms as default response stream throttle", async () => {
    vi.stubEnv("RESPONSE_STREAM_THROTTLE_MS", "");

    const config = await loadConfig();

    expect(config.bot.responseStreamThrottleMs).toBe(1000);
  });

  it("parses response stream throttle", async () => {
    vi.stubEnv("RESPONSE_STREAM_THROTTLE_MS", "750");

    const config = await loadConfig();

    expect(config.bot.responseStreamThrottleMs).toBe(750);
  });

  it("falls back to default response stream throttle on invalid value", async () => {
    vi.stubEnv("RESPONSE_STREAM_THROTTLE_MS", "zero");

    const config = await loadConfig();

    expect(config.bot.responseStreamThrottleMs).toBe(1000);
  });

  it("parses scheduled task poll interval", async () => {
    vi.stubEnv("SCHEDULED_TASK_POLL_INTERVAL_SEC", "45");

    const config = await loadConfig();

    expect(config.bot.scheduledTasksPollIntervalSec).toBe(45);
  });

  it("falls back to STT credentials for TTS when dedicated vars are unset", async () => {
    vi.stubEnv("STT_API_URL", "https://api.openai.com/v1");
    vi.stubEnv("STT_API_KEY", "sk-test-key");
    vi.stubEnv("TTS_API_URL", "");
    vi.stubEnv("TTS_API_KEY", "");
    vi.stubEnv("TTS_VOICE", "");

    const config = await loadConfig();

    expect(config.tts.apiUrl).toBe("https://api.openai.com/v1");
    expect(config.tts.apiKey).toBe("sk-test-key");
    expect(config.tts.model).toBe("gpt-4o-mini-tts");
    expect(config.tts.voice).toBe("alloy");
  });
});
