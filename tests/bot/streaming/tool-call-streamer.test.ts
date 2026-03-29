import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolCallStreamer } from "../../../src/bot/streaming/tool-call-streamer.js";

describe("bot/streaming/tool-call-streamer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("replaces updates by prefix so subagent cards do not accumulate", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(77);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteMessage = vi.fn().mockResolvedValue(undefined);
    const streamer = new ToolCallStreamer({ sendText, editText, deleteMessage, throttleMs: 100 });

    streamer.pushUpdate("s1", "⏳ bash npm test");
    streamer.replaceByPrefix("s1", "🧩", "🧩 Task: first");

    await vi.advanceTimersByTimeAsync(100);

    expect(sendText).toHaveBeenCalledWith("s1", "⏳ bash npm test\n\n🧩 Task: first");

    streamer.replaceByPrefix("s1", "🧩", "🧩 Task: second");
    await vi.advanceTimersByTimeAsync(100);

    expect(editText).toHaveBeenCalledWith("s1", 77, "⏳ bash npm test\n\n🧩 Task: second");
    expect(editText).not.toHaveBeenCalledWith(
      "s1",
      77,
      expect.stringContaining("Task: first\n\n🧩 Task: second"),
    );
  });
});
