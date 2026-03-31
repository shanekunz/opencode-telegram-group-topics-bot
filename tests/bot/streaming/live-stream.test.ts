import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveStream } from "../../../src/bot/streaming/live-stream.js";

describe("bot/streaming/live-stream", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps assistant and service updates in one stream lane", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(101);
    const editText = vi.fn().mockResolvedValue(undefined);
    const stream = new LiveStream({ sendText, editText, throttleMs: 50 });

    await stream.updateAssistant("s1", "m1", "Assistant start");
    stream.pushServiceUpdate("s1", "⏳ bash npm test");
    await vi.advanceTimersByTimeAsync(50);

    expect(sendText).toHaveBeenCalledWith(
      "s1",
      "Assistant start\n\n⏳ bash npm test",
      "raw",
      false,
    );
    expect(editText).not.toHaveBeenCalled();
  });

  it("keeps the thinking line and appends assistant text below it", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(102);
    const editText = vi.fn().mockResolvedValue(undefined);
    const stream = new LiveStream({ sendText, editText, throttleMs: 50 });

    stream.showThinking("s1", "Thinking");
    await vi.advanceTimersByTimeAsync(50);
    await stream.updateAssistant("s1", "m1", "Assistant start");
    await vi.advanceTimersByTimeAsync(50);

    expect(editText).toHaveBeenCalledWith("s1", 102, "Thinking\n\nAssistant start", "raw", false);
  });

  it("starts a new streamed message after a file boundary seal", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(11);
    const editText = vi.fn().mockResolvedValue(undefined);
    const stream = new LiveStream({ sendText, editText, throttleMs: 50 });

    await stream.completeAssistant("s1", "m1", "Before file");
    await stream.sealCurrentMessage("s1");
    await stream.updateAssistant("s1", "m1", "Before file\n\nAfter file");
    await vi.advanceTimersByTimeAsync(50);

    expect(sendText).toHaveBeenNthCalledWith(1, "s1", "Before file", "raw", false);
    expect(sendText).toHaveBeenNthCalledWith(2, "s1", "After file", "raw", false);
  });

  it("does not replay the just-sealed assistant prefix after a file boundary", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValueOnce(12).mockResolvedValueOnce(13);
    const editText = vi.fn().mockResolvedValue(undefined);
    const stream = new LiveStream({ sendText, editText, throttleMs: 50 });

    await stream.updateAssistant("s1", "m1", "Cycle 1: first update to the file.");
    await vi.advanceTimersByTimeAsync(50);

    await stream.sealCurrentMessage("s1", false, true);
    await stream.updateAssistant(
      "s1",
      "m2",
      "Cycle 1: first update to the file.\n\nCycle 2: second update to the file.",
    );
    await vi.advanceTimersByTimeAsync(50);

    expect(sendText).toHaveBeenNthCalledWith(
      1,
      "s1",
      "Cycle 1: first update to the file.",
      "raw",
      false,
    );
    expect(sendText).toHaveBeenNthCalledWith(
      2,
      "s1",
      "Cycle 2: second update to the file.",
      "raw",
      false,
    );
  });

  it("updates the current assistant entry in place while keeping service order", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(20);
    const editText = vi.fn().mockResolvedValue(undefined);
    const stream = new LiveStream({ sendText, editText, throttleMs: 50 });

    await stream.updateAssistant("s1", "m1", "First message");
    await vi.advanceTimersByTimeAsync(50);
    stream.pushServiceUpdate("s1", "✅ tool finished");
    await stream.updateAssistant("s1", "m1", "First message extended");
    await vi.advanceTimersByTimeAsync(50);

    expect(editText).toHaveBeenCalledWith(
      "s1",
      20,
      "First message extended\n\n✅ tool finished",
      "raw",
      false,
    );
  });

  it("rolls over into a new message when the stream exceeds Telegram length", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValueOnce(31).mockResolvedValueOnce(32);
    const editText = vi.fn().mockResolvedValue(undefined);
    const stream = new LiveStream({ sendText, editText, throttleMs: 50 });

    const longText = `${"A".repeat(3000)}\n\n${"B".repeat(1800)}`;
    await stream.updateAssistant("s1", "m1", longText);
    await vi.advanceTimersByTimeAsync(50);

    expect(sendText).toHaveBeenCalledTimes(2);
    expect(sendText.mock.calls[0][1].length).toBeLessThanOrEqual(4096);
    expect(sendText.mock.calls[1][1].length).toBeLessThanOrEqual(4096);
    expect(editText).not.toHaveBeenCalled();
  });

  it("truncates oversized replaceable service updates so they remain replaceable", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(51);
    const editText = vi.fn().mockResolvedValue(undefined);
    const stream = new LiveStream({ sendText, editText, throttleMs: 50 });

    stream.replaceServiceByPrefix("s1", "🧩", `🧩 ${"x".repeat(5000)}`);
    await vi.advanceTimersByTimeAsync(50);

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0][1].length).toBeLessThanOrEqual(3500);
  });

  it("keeps assistant rollover progress correct across trimmed boundaries", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValueOnce(61).mockResolvedValueOnce(62);
    const editText = vi.fn().mockResolvedValue(undefined);
    const stream = new LiveStream({ sendText, editText, throttleMs: 50 });

    const firstPass = `${"A".repeat(4094)}\n\nB`;
    await stream.updateAssistant("s1", "m1", firstPass);
    await vi.advanceTimersByTimeAsync(50);

    await stream.updateAssistant("s1", "m1", `${firstPass}CCCC`);
    await vi.advanceTimersByTimeAsync(50);

    const renderedParts = sendText.mock.calls.map((call) => call[1]);
    expect(renderedParts[0]).toBe("A".repeat(4094));
    expect(renderedParts[1]).toBe("B");
    expect(editText).toHaveBeenLastCalledWith("s1", 62, "BCCCC", "raw", false);
  });

  it("removes the current raw assistant block before final delivery when service text exists", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(71);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const stream = new LiveStream({ sendText, editText, deleteText, throttleMs: 50 });

    stream.showThinking("s1", "Thinking");
    await stream.updateAssistant("s1", "m1", "Final answer");
    await vi.advanceTimersByTimeAsync(50);

    await stream.cleanupAfterFinalDelivery("s1");

    expect(editText).toHaveBeenLastCalledWith("s1", 71, "Thinking", "raw", false);
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("deletes the current raw streamed message before final delivery when it only contains assistant text", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(81);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const stream = new LiveStream({ sendText, editText, deleteText, throttleMs: 50 });

    await stream.updateAssistant("s1", "m1", "Final answer");
    await vi.advanceTimersByTimeAsync(50);

    await stream.cleanupAfterFinalDelivery("s1");

    expect(deleteText).toHaveBeenCalledWith("s1", 81);
    expect(editText).not.toHaveBeenCalled();
  });
});
