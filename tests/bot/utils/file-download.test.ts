import { Agent as HttpsAgent } from "node:https";
import type { Api } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatFileSize,
  isFileSizeAllowed,
  isTextMimeType,
  toDataUri,
} from "../../../src/bot/utils/file-download.js";

const nodeFetchMock = vi.hoisted(() => vi.fn());

vi.mock("node-fetch", () => ({
  default: nodeFetchMock,
}));

describe("bot/utils/file-download", () => {
  it("converts buffer to base64 data URI", () => {
    const buffer = Buffer.from("hello");

    expect(toDataUri(buffer, "text/plain")).toBe("data:text/plain;base64,aGVsbG8=");
  });

  it("formats file sizes", () => {
    expect(formatFileSize(100)).toBe("100B");
    expect(formatFileSize(1536)).toBe("1.5KB");
    expect(formatFileSize(2 * 1024 * 1024)).toBe("2.0MB");
  });

  it("checks size limits", () => {
    expect(isFileSizeAllowed(undefined, 100)).toBe(true);
    expect(isFileSizeAllowed(50 * 1024, 100)).toBe(true);
    expect(isFileSizeAllowed(150 * 1024, 100)).toBe(false);
  });

  it("recognizes text MIME types", () => {
    expect(isTextMimeType("text/plain")).toBe(true);
    expect(isTextMimeType("application/json")).toBe(true);
    expect(isTextMimeType("application/pdf")).toBe(false);
    expect(isTextMimeType(undefined)).toBe(false);
  });
});

describe("downloadTelegramFile connectivity wiring", () => {
  beforeEach(() => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot-token-xyz");
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", "123456789");
    vi.stubEnv("OPENCODE_MODEL_PROVIDER", "test-provider");
    vi.stubEnv("OPENCODE_MODEL_ID", "test-model");
    vi.stubEnv("TELEGRAM_PROXY_URL", "");
    vi.stubEnv("TELEGRAM_API_ROOT", "");
    vi.stubEnv("TELEGRAM_PROXY_SECRET", "");
    vi.stubEnv("TELEGRAM_FORCE_IPV4", "");
    nodeFetchMock.mockReset();
  });

  function makeApiStub(): Api {
    return {
      getFile: vi.fn().mockResolvedValue({
        file_path: "voice/sample.ogg",
        file_size: 100,
      }),
    } as unknown as Api;
  }

  function makeFetchStub(): ReturnType<typeof vi.fn> {
    return nodeFetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
  }

  async function loadDownloadModule() {
    vi.resetModules();
    return import("../../../src/bot/utils/file-download.js");
  }

  it("uses api.telegram.org when TELEGRAM_API_ROOT is unset", async () => {
    const fetchMock = makeFetchStub();

    const { downloadTelegramFile } = await loadDownloadModule();
    await downloadTelegramFile(makeApiStub(), "fid");

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/file/botbot-token-xyz/voice/sample.ogg");
  });

  it("uses TELEGRAM_API_ROOT when configured", async () => {
    vi.stubEnv("TELEGRAM_API_ROOT", "https://tg-proxy.example.com/");
    const fetchMock = makeFetchStub();

    const { downloadTelegramFile } = await loadDownloadModule();
    await downloadTelegramFile(makeApiStub(), "fid");

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://tg-proxy.example.com/file/botbot-token-xyz/voice/sample.ogg");
  });

  it("sends X-Proxy-Secret when configured", async () => {
    vi.stubEnv("TELEGRAM_API_ROOT", "https://tg-proxy.example.com");
    vi.stubEnv("TELEGRAM_PROXY_SECRET", "secret-abc");
    const fetchMock = makeFetchStub();

    const { downloadTelegramFile } = await loadDownloadModule();
    await downloadTelegramFile(makeApiStub(), "fid");

    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as { headers?: Record<string, string> } | undefined)?.headers;
    expect(headers?.["X-Proxy-Secret"]).toBe("secret-abc");
  });

  it("does not configure an agent for direct downloads by default", async () => {
    const fetchMock = makeFetchStub();

    const { downloadTelegramFile } = await loadDownloadModule();
    await downloadTelegramFile(makeApiStub(), "fid");

    const [, init] = fetchMock.mock.calls[0];
    expect((init as { agent?: unknown } | undefined)?.agent).toBeUndefined();
  });

  it("uses an IPv4 HTTPS agent when TELEGRAM_FORCE_IPV4 is enabled", async () => {
    vi.stubEnv("TELEGRAM_FORCE_IPV4", "true");
    const fetchMock = makeFetchStub();

    const { downloadTelegramFile } = await loadDownloadModule();
    await downloadTelegramFile(makeApiStub(), "fid");

    const [, init] = fetchMock.mock.calls[0];
    const agent = (init as { agent?: unknown } | undefined)?.agent;
    expect(agent).toBeInstanceOf(HttpsAgent);
    expect((agent as HttpsAgent).options.family).toBe(4);
  });
});
