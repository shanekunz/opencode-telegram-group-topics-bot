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

  it("coalesces queued edits for the same message without changing queue order", async () => {
    vi.useFakeTimers();

    const limiter = new TelegramRateLimiter();
    const executionOrder: string[] = [];

    const primeJob = limiter.enqueue(
      "sendMessage",
      {
        chat_id: -1001,
        message_thread_id: 77,
      },
      async () => {
        executionOrder.push("prime");
        return "prime-ok";
      },
    );

    await vi.advanceTimersByTimeAsync(0);
    await primeJob;

    const firstEditJob = limiter.enqueue(
      "editMessageText",
      {
        chat_id: -1001,
        message_thread_id: 77,
        message_id: 10,
      },
      async () => {
        executionOrder.push("edit-1");
        return "edit-1-ok";
      },
    );

    const fileJob = limiter.enqueue(
      "sendDocument",
      {
        chat_id: -1001,
        message_thread_id: 77,
      },
      async () => {
        executionOrder.push("file");
        return "file-ok";
      },
    );

    const secondEditJob = limiter.enqueue(
      "editMessageText",
      {
        chat_id: -1001,
        message_thread_id: 77,
        message_id: 10,
      },
      async () => {
        executionOrder.push("edit-2");
        return "edit-2-ok";
      },
    );

    await vi.advanceTimersByTimeAsync(3_000);
    await Promise.all([firstEditJob, secondEditJob, fileJob]);

    expect(executionOrder).toEqual(["prime", "edit-2", "file"]);

    vi.useRealTimers();
  });

  it("enqueues a new edit after an in-flight edit instead of coalescing it", async () => {
    vi.useFakeTimers();

    const limiter = new TelegramRateLimiter();
    const executionOrder: string[] = [];
    const firstEditGateControl: { release: (() => void) | null } = { release: null };
    const firstEditGate = new Promise<void>((resolve) => {
      firstEditGateControl.release = resolve;
    });

    const firstEditJob = limiter.enqueue(
      "editMessageText",
      {
        chat_id: -1001,
        message_thread_id: 77,
        message_id: 10,
      },
      async () => {
        executionOrder.push("edit-1");
        await firstEditGate;
        return "edit-1-ok";
      },
    );

    await vi.advanceTimersByTimeAsync(0);

    const fileJob = limiter.enqueue(
      "sendDocument",
      {
        chat_id: -1001,
        message_thread_id: 77,
      },
      async () => {
        executionOrder.push("file");
        return "file-ok";
      },
    );

    const secondEditJob = limiter.enqueue(
      "editMessageText",
      {
        chat_id: -1001,
        message_thread_id: 77,
        message_id: 10,
      },
      async () => {
        executionOrder.push("edit-2");
        return "edit-2-ok";
      },
    );

    const release = firstEditGateControl.release;
    if (typeof release === "function") {
      release();
    }

    await vi.advanceTimersByTimeAsync(3_000);
    await Promise.all([firstEditJob, fileJob, secondEditJob]);

    expect(executionOrder).toEqual(["edit-1", "file", "edit-2"]);

    vi.useRealTimers();
  });
});
