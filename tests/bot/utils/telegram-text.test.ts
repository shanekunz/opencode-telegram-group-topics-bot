import { describe, expect, it, vi } from "vitest";
import { editBotText, sendBotText } from "../../../src/bot/utils/telegram-text.js";

describe("bot/utils/telegram-text", () => {
  it("sends raw text by default", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    await sendBotText({
      api: { sendMessage },
      chatId: 123,
      text: "hello",
      options: { disable_notification: true },
    });

    expect(sendMessage).toHaveBeenCalledWith(123, "hello", {
      disable_notification: true,
    });
  });

  it("sends markdown_v2 text with markdown parse mode", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    await sendBotText({
      api: { sendMessage },
      chatId: 123,
      text: "*hello*",
      format: "markdown_v2",
    });

    expect(sendMessage).toHaveBeenCalledWith(123, "*hello*", {
      parse_mode: "MarkdownV2",
    });
  });

  it("uses raw fallback text when markdown parse fails", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Bad Request: can't parse entities: Character '.' is reserved"),
      )
      .mockRejectedValueOnce(new Error("Bad Request: can't parse entities: unsupported start tag"))
      .mockResolvedValueOnce(undefined);

    await sendBotText({
      api: { sendMessage },
      chatId: 100,
      text: "Build succeeded.",
      rawFallbackText: "Build succeeded.",
      format: "markdown_v2",
    });

    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(sendMessage).toHaveBeenNthCalledWith(3, 100, "Build succeeded.", undefined);
  });

  it("edits raw text by default", async () => {
    const editMessageText = vi.fn().mockResolvedValue(undefined);

    await editBotText({
      api: { editMessageText },
      chatId: 321,
      messageId: 9,
      text: "hello",
    });

    expect(editMessageText).toHaveBeenCalledWith(321, 9, "hello", undefined);
  });
});
