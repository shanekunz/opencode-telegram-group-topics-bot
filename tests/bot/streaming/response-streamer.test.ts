import { afterEach, describe, expect, it, vi } from "vitest";
import { ResponseStreamer } from "../../../src/bot/streaming/response-streamer.js";

describe("bot/streaming/response-streamer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the first streamed chunk and throttles edits per session", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(101);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteMessage = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({ sendText, editText, deleteMessage, throttleMs: 100 });

    await streamer.update("s1", "Hello", "raw");
    await streamer.update("s1", "Hello world", "raw");

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(editText).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);

    expect(editText).toHaveBeenCalledTimes(1);
    expect(editText).toHaveBeenCalledWith("s1", 101, "Hello world", "raw", false);
  });

  it("keeps unrelated session streams independent", async () => {
    const sendText = vi.fn().mockResolvedValueOnce(11).mockResolvedValueOnce(22);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteMessage = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({ sendText, editText, deleteMessage, throttleMs: 50 });

    await Promise.all([
      streamer.update("session-a", "Alpha", "raw"),
      streamer.update("session-b", "Beta", "markdown_v2"),
    ]);

    expect(sendText).toHaveBeenNthCalledWith(1, "session-a", "Alpha", "raw");
    expect(sendText).toHaveBeenNthCalledWith(2, "session-b", "Beta", "markdown_v2");
  });

  it("deletes the streamed message and falls back when streaming is disabled for overflow", async () => {
    const sendText = vi.fn().mockResolvedValue(44);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteMessage = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({ sendText, editText, deleteMessage });

    await streamer.update("s1", "Partial", "raw");
    streamer.markFallback("s1");

    await expect(streamer.finalize("s1", "Final full answer", "raw")).resolves.toBe(false);
    expect(deleteMessage).toHaveBeenCalledWith("s1", 44);
  });

  it("removes the streamed message before final re-delivery", async () => {
    const sendText = vi.fn().mockResolvedValue(55);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteMessage = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({ sendText, editText, deleteMessage });

    await streamer.update("s1", "Partial", "raw");

    await expect(streamer.resetForFinalDelivery("s1")).resolves.toBe(true);
    expect(deleteMessage).toHaveBeenCalledWith("s1", 55);
  });
});
