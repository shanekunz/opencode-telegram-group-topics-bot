import { describe, expect, it, vi } from "vitest";
import { TelegramRateLimiter } from "../../src/bot/telegram-rate-limiter.js";

function createRetryAfterError(seconds: number): { parameters: { retry_after: number } } {
  return {
    parameters: {
      retry_after: seconds,
    },
  };
}

describe("bot/telegram-rate-limiter", () => {
  it("keeps in-order delivery for same scope after retry", async () => {
    vi.useFakeTimers();

    const limiter = new TelegramRateLimiter();
    const executionOrder: string[] = [];
    let firstJobAttempt = 0;

    const firstJob = limiter.enqueue(
      "sendMessage",
      {
        chat_id: -1001,
        message_thread_id: 77,
      },
      async () => {
        firstJobAttempt += 1;
        executionOrder.push(`first-${firstJobAttempt}`);

        if (firstJobAttempt === 1) {
          throw createRetryAfterError(1);
        }

        return "first-ok";
      },
    );

    const secondJob = limiter.enqueue(
      "sendMessage",
      {
        chat_id: -1001,
        message_thread_id: 77,
      },
      async () => {
        executionOrder.push("second");
        return "second-ok";
      },
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(executionOrder).toEqual(["first-1"]);

    await vi.advanceTimersByTimeAsync(3_000);
    await Promise.all([firstJob, secondJob]);

    expect(executionOrder).toEqual(["first-1", "first-2", "second"]);

    vi.useRealTimers();
  });
});
