import { logger } from "../utils/logger.js";
import { createScopeKeyFromParams } from "./scope.js";

const GLOBAL_MIN_INTERVAL_MS = 40;
const PER_CHAT_SEND_INTERVAL_MS = 1100;
const PER_CHAT_EDIT_INTERVAL_MS = 250;
const GROUP_WINDOW_MS = 60_000;
const GROUP_LIMIT_PER_WINDOW = 20;

const RATE_LIMITED_METHODS = new Set<string>([
  "sendMessage",
  "editMessageText",
  "sendDocument",
  "sendPhoto",
  "sendAudio",
  "sendVoice",
  "sendVideo",
  "sendAnimation",
  "sendMediaGroup",
]);

interface QueueJob {
  method: string;
  payload: unknown;
  scopeKey: string | null;
  chatId: number | null;
  isGroupLike: boolean;
  notBefore: number;
  run: () => Promise<unknown>;
  resolves: Array<(value: unknown) => void>;
  rejects: Array<(error: unknown) => void>;
}

function isEditMessageJob(job: QueueJob): boolean {
  return job.method === "editMessageText";
}

function getPerChatIntervalMs(job: QueueJob): number {
  return isEditMessageJob(job) ? PER_CHAT_EDIT_INTERVAL_MS : PER_CHAT_SEND_INTERVAL_MS;
}

function countsTowardsGroupWindow(job: QueueJob): boolean {
  return !isEditMessageJob(job);
}

function parseMessageId(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const value = Reflect.get(payload, "message_id");
  return typeof value === "number" ? value : null;
}

function parseChatId(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const value = Reflect.get(payload, "chat_id");
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseThreadId(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const value = Reflect.get(payload, "message_thread_id");
  return typeof value === "number" ? value : null;
}

function scopeKeyFromPayload(payload: unknown): string | null {
  const chatId = parseChatId(payload);
  if (chatId === null) {
    return null;
  }

  if (chatId > 0) {
    return createScopeKeyFromParams({
      chatId,
      context: "dm",
    });
  }

  const threadId = parseThreadId(payload);
  if (threadId !== null) {
    return createScopeKeyFromParams({
      chatId,
      threadId,
      context: threadId === 1 ? "group-general" : "group-topic",
    });
  }

  return createScopeKeyFromParams({
    chatId,
    context: "group-general",
  });
}

function isGroupLikeChat(chatId: number | null): boolean {
  return chatId !== null && chatId < 0;
}

function getRetryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const params = Reflect.get(error, "parameters");
  if (!params || typeof params !== "object") {
    return null;
  }

  const retryAfter = Reflect.get(params, "retry_after");
  if (typeof retryAfter !== "number" || retryAfter <= 0) {
    return null;
  }

  return retryAfter * 1000;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TelegramRateLimiter {
  private readonly queue: QueueJob[] = [];
  private processing = false;
  private lastGlobalSentAt = 0;
  private readonly lastSentAtByChat = new Map<number, number>();
  private readonly groupWindowByChat = new Map<number, number[]>();
  private activeScopeKey: string | null = null;

  private findCoalescibleEditIndex(payload: unknown): number {
    const scopeKey = scopeKeyFromPayload(payload);
    const messageId = parseMessageId(payload);
    if (!scopeKey || messageId === null) {
      return -1;
    }

    for (let index = this.queue.length - 1; index >= 0; index--) {
      const job = this.queue[index];
      if (!isEditMessageJob(job) || job.scopeKey !== scopeKey) {
        continue;
      }

      if (parseMessageId(job.payload) === messageId) {
        return index;
      }
    }

    return -1;
  }

  setActiveScopeKey(scopeKey: string | null): void {
    this.activeScopeKey = scopeKey;
  }

  private async executeWithRetryAfter<T>(method: string, run: () => Promise<T>): Promise<T> {
    while (true) {
      try {
        return await run();
      } catch (error) {
        const retryAfterMs = getRetryAfterMs(error);
        if (!retryAfterMs) {
          throw error;
        }

        const delayMs = retryAfterMs + 100;
        logger.info(`[RateLimiter] Telegram rate limit for ${method}; retry in ${delayMs}ms`);
        await sleep(delayMs);
      }
    }
  }

  enqueue<T>(method: string, payload: unknown, run: () => Promise<T>): Promise<T> {
    if (!RATE_LIMITED_METHODS.has(method)) {
      return this.executeWithRetryAfter(method, run);
    }

    const promise = new Promise<unknown>((resolve, reject) => {
      if (method === "editMessageText") {
        const existingIndex = this.findCoalescibleEditIndex(payload);
        if (existingIndex >= 0) {
          const existingJob = this.queue[existingIndex];
          existingJob.payload = payload;
          existingJob.run = run as () => Promise<unknown>;
          existingJob.resolves.push(resolve);
          existingJob.rejects.push(reject);
          return;
        }
      }

      const chatId = parseChatId(payload);
      const job: QueueJob = {
        method,
        payload,
        scopeKey: scopeKeyFromPayload(payload),
        chatId,
        isGroupLike: isGroupLikeChat(chatId),
        notBefore: 0,
        run: run as () => Promise<unknown>,
        resolves: [resolve],
        rejects: [reject],
      };

      this.queue.push(job);
      if (this.queue.length > 25) {
        logger.debug(`[RateLimiter] Outbound queue depth=${this.queue.length}`);
      }

      this.ensureProcessing();
    });
    return promise as Promise<T>;
  }

  private ensureProcessing(): void {
    if (this.processing) {
      return;
    }

    this.processing = true;
    void this.processLoop();
  }

  private findNextIndex(now: number): { index: number; waitMs: number } {
    let prioritizedReadyIndex = -1;
    let firstReadyIndex = -1;
    let minWaitMs = Number.POSITIVE_INFINITY;
    let minWaitIndex = 0;
    const seenScopeKeys = new Set<string>();

    for (let index = 0; index < this.queue.length; index++) {
      const job = this.queue[index];

      // Keep strict in-order delivery per scope.
      // If a scope already has an earlier queued job, skip later jobs for the same scope
      // until the head-of-line job is processed.
      if (job.scopeKey) {
        if (seenScopeKeys.has(job.scopeKey)) {
          continue;
        }

        seenScopeKeys.add(job.scopeKey);
      }

      const waitMs = this.getWaitMs(job, now);

      if (waitMs <= 0) {
        if (
          this.activeScopeKey &&
          prioritizedReadyIndex < 0 &&
          job.scopeKey === this.activeScopeKey
        ) {
          prioritizedReadyIndex = index;
        }

        if (firstReadyIndex < 0) {
          firstReadyIndex = index;
        }

        continue;
      }

      if (waitMs < minWaitMs) {
        minWaitMs = waitMs;
        minWaitIndex = index;
      }
    }

    if (prioritizedReadyIndex >= 0) {
      return { index: prioritizedReadyIndex, waitMs: 0 };
    }

    if (firstReadyIndex >= 0) {
      return { index: firstReadyIndex, waitMs: 0 };
    }

    return {
      index: minWaitIndex,
      waitMs: Number.isFinite(minWaitMs) ? Math.max(1, minWaitMs) : 1,
    };
  }

  private pruneGroupWindow(chatId: number, now: number): number[] {
    const current = this.groupWindowByChat.get(chatId) ?? [];
    const pruned = current.filter((ts) => now - ts < GROUP_WINDOW_MS);
    this.groupWindowByChat.set(chatId, pruned);
    return pruned;
  }

  private getWaitMs(job: QueueJob, now: number = Date.now()): number {
    const waits: number[] = [];

    waits.push(job.notBefore - now);

    waits.push(this.lastGlobalSentAt + GLOBAL_MIN_INTERVAL_MS - now);

    if (job.chatId !== null) {
      const lastPerChat = this.lastSentAtByChat.get(job.chatId) ?? 0;
      waits.push(lastPerChat + getPerChatIntervalMs(job) - now);
    }

    if (job.isGroupLike && job.chatId !== null && countsTowardsGroupWindow(job)) {
      const timestamps = this.pruneGroupWindow(job.chatId, now);
      if (timestamps.length >= GROUP_LIMIT_PER_WINDOW) {
        waits.push(timestamps[0] + GROUP_WINDOW_MS - now);
      }
    }

    return Math.max(0, ...waits);
  }

  private markSent(job: QueueJob): void {
    const now = Date.now();
    this.lastGlobalSentAt = now;

    if (job.chatId !== null) {
      this.lastSentAtByChat.set(job.chatId, now);
    }

    if (job.isGroupLike && job.chatId !== null && countsTowardsGroupWindow(job)) {
      const timestamps = this.pruneGroupWindow(job.chatId, now);
      timestamps.push(now);
      this.groupWindowByChat.set(job.chatId, timestamps);
    }
  }

  private async executeJob(job: QueueJob): Promise<"done" | "retry"> {
    try {
      const result = await job.run();
      this.markSent(job);
      for (const resolve of job.resolves) {
        resolve(result);
      }
      return "done";
    } catch (error) {
      const retryAfterMs = getRetryAfterMs(error);
      if (!retryAfterMs) {
        for (const reject of job.rejects) {
          reject(error);
        }
        return "done";
      }

      const delayMs = retryAfterMs + 100;
      job.notBefore = Date.now() + delayMs;
      logger.info(`[RateLimiter] Telegram rate limit for ${job.method}; retry in ${delayMs}ms`);
      return "retry";
    }
  }

  private requeueRetryJob(job: QueueJob): void {
    if (!job.scopeKey) {
      this.queue.push(job);
      return;
    }

    const sameScopeIndex = this.queue.findIndex((queued) => queued.scopeKey === job.scopeKey);
    if (sameScopeIndex < 0) {
      this.queue.push(job);
      return;
    }

    this.queue.splice(sameScopeIndex, 0, job);
  }

  private async processLoop(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        const now = Date.now();
        const selection = this.findNextIndex(now);
        if (selection.waitMs > 0) {
          await sleep(selection.waitMs);
          continue;
        }

        const index = selection.index;
        const [job] = this.queue.splice(index, 1);
        const outcome = await this.executeJob(job);
        if (outcome === "retry") {
          this.requeueRetryJob(job);
        }
      }
    } finally {
      this.processing = false;
      if (this.queue.length > 0) {
        this.ensureProcessing();
      }
    }
  }
}
