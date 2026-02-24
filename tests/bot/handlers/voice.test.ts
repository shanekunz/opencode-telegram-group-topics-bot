import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { handleVoiceMessage, type VoiceMessageDeps } from "../../../src/bot/handlers/voice.js";
import { t } from "../../../src/i18n/index.js";

function createVoiceContext(): {
  ctx: Context;
  replyMock: ReturnType<typeof vi.fn>;
  editMessageTextMock: ReturnType<typeof vi.fn>;
} {
  const replyMock = vi.fn().mockResolvedValue({ message_id: 101 });
  const editMessageTextMock = vi.fn().mockResolvedValue(true);

  const ctx = {
    chat: { id: 777 },
    message: {
      voice: {
        file_id: "voice-file-id",
      },
    },
    reply: replyMock,
    api: {
      editMessageText: editMessageTextMock,
    },
  } as unknown as Context;

  return { ctx, replyMock, editMessageTextMock };
}

function createVoiceDeps(overrides: Partial<VoiceMessageDeps> = {}): {
  deps: VoiceMessageDeps;
  processPromptMock: ReturnType<typeof vi.fn>;
  downloadMock: ReturnType<typeof vi.fn>;
  transcribeMock: ReturnType<typeof vi.fn>;
} {
  const processPromptMock = vi.fn().mockResolvedValue(true);
  const downloadMock = vi.fn().mockResolvedValue({
    buffer: Buffer.from("audio"),
    filename: "file_1.oga",
  });
  const transcribeMock = vi.fn().mockResolvedValue({ text: "run tests" });

  const deps: VoiceMessageDeps = {
    bot: {} as VoiceMessageDeps["bot"],
    ensureEventSubscription: vi.fn().mockResolvedValue(undefined),
    isSttConfigured: vi.fn(() => true),
    downloadTelegramFile: downloadMock,
    transcribeAudio: transcribeMock,
    processPrompt: processPromptMock,
    ...overrides,
  };

  return { deps, processPromptMock, downloadMock, transcribeMock };
}

describe("bot/handlers/voice", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("continues with prompt processing when recognized text message edit fails", async () => {
    const { ctx, replyMock, editMessageTextMock } = createVoiceContext();
    const { deps, processPromptMock } = createVoiceDeps();

    editMessageTextMock.mockRejectedValueOnce(new Error("message is too long"));

    await handleVoiceMessage(ctx, deps);

    expect(replyMock).toHaveBeenCalledWith(t("stt.recognizing"));
    expect(processPromptMock).toHaveBeenCalledWith(ctx, "run tests", deps);
  });

  it("returns not-configured message and does not process prompt", async () => {
    const { ctx, replyMock } = createVoiceContext();
    const { deps, processPromptMock, downloadMock } = createVoiceDeps({
      isSttConfigured: () => false,
    });

    await handleVoiceMessage(ctx, deps);

    expect(replyMock).toHaveBeenCalledWith(t("stt.not_configured"));
    expect(downloadMock).not.toHaveBeenCalled();
    expect(processPromptMock).not.toHaveBeenCalled();
  });

  it("shows empty-result message and skips prompt processing", async () => {
    const { ctx, editMessageTextMock } = createVoiceContext();
    const { deps, processPromptMock } = createVoiceDeps({
      transcribeAudio: vi.fn().mockResolvedValue({ text: "   " }),
    });

    await handleVoiceMessage(ctx, deps);

    expect(editMessageTextMock).toHaveBeenCalledWith(777, 101, t("stt.empty_result"));
    expect(processPromptMock).not.toHaveBeenCalled();
  });
});
