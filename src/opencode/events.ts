import { Event } from "@opencode-ai/sdk/v2";
import { opencodeClient } from "./client.js";
import { logger } from "../utils/logger.js";

type EventCallback = (event: Event) => void | Promise<void>;
type EventStreamSource = "global" | "legacy";
type EventStreamSubscription = {
  source: EventStreamSource;
  stream: AsyncGenerator<unknown, unknown, unknown>;
};
type EventSubscriptionResult = {
  stream?: AsyncGenerator<unknown, unknown, unknown> | null;
};
type OptionalGlobalEventApi = {
  event?: (options?: { signal?: AbortSignal }) => Promise<EventSubscriptionResult>;
};
type OptionalGlobalEventClient = {
  global?: OptionalGlobalEventApi;
};

interface DirectoryStreamWorker {
  directory: string;
  callbacks: Set<EventCallback>;
  abortController: AbortController;
  loopPromise: Promise<void> | null;
}

type StreamReadResult =
  | { type: "next"; result: IteratorResult<unknown, unknown> }
  | { type: "error"; error: unknown }
  | { type: "aborted" }
  | { type: "timeout" };

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;
const FATAL_NO_STREAM_ERROR = "No stream returned from event subscription";
const SSE_IDLE_TIMEOUT_ERROR = "SSE stream idle timeout";

let sseIdleTimeoutMs = 30_000;

const workersByDirectory = new Map<string, DirectoryStreamWorker>();

function getReconnectDelayMs(attempt: number): number {
  const exponentialDelay = RECONNECT_BASE_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(exponentialDelay, RECONNECT_MAX_DELAY_MS);
}

function waitWithAbort(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }

    const onAbort = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    };

    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function createAttemptAbortController(parentSignal: AbortSignal): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();

  if (parentSignal.aborted) {
    controller.abort();
    return { controller, cleanup: () => {} };
  }

  const onAbort = () => controller.abort();
  parentSignal.addEventListener("abort", onAbort, { once: true });

  return {
    controller,
    cleanup: () => parentSignal.removeEventListener("abort", onAbort),
  };
}

function readStreamWithIdleTimeout(
  stream: AsyncGenerator<unknown, unknown, unknown>,
  signal: AbortSignal,
): Promise<StreamReadResult> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (result: StreamReadResult) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };

    const onAbort = () => finish({ type: "aborted" });
    const timeoutId = setTimeout(() => finish({ type: "timeout" }), sseIdleTimeoutMs);

    if (signal.aborted) {
      finish({ type: "aborted" });
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });

    stream.next().then(
      (result) => finish({ type: "next", result }),
      (error) => finish({ type: "error", error }),
    );
  });
}

function isEventStreamIdleTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message === SSE_IDLE_TIMEOUT_ERROR;
}

function getOrCreateWorker(directory: string): DirectoryStreamWorker {
  const existingWorker = workersByDirectory.get(directory);
  if (existingWorker) {
    return existingWorker;
  }

  const nextWorker: DirectoryStreamWorker = {
    directory,
    callbacks: new Set<EventCallback>(),
    abortController: new AbortController(),
    loopPromise: null,
  };

  workersByDirectory.set(directory, nextWorker);
  return nextWorker;
}

function isExpectedOpencodeUnavailableError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  return (
    normalized.includes("fetch failed") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("econnrefused") ||
    normalized.includes("econnreset") ||
    normalized.includes("enotfound") ||
    normalized.includes("connectex")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEventLike(value: unknown): value is Event {
  return isRecord(value) && typeof value.type === "string" && isRecord(value.properties);
}

function normalizeDirectoryForComparison(directory: string): string {
  const normalized = directory.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
}

function isSameDirectory(left: string, right: string): boolean {
  return normalizeDirectoryForComparison(left) === normalizeDirectoryForComparison(right);
}

function normalizeGlobalEvent(rawEvent: unknown, directory: string): Event | null {
  if (isEventLike(rawEvent)) {
    return rawEvent;
  }

  if (!isRecord(rawEvent) || !("payload" in rawEvent)) {
    logger.debug("[Events] Ignoring global event with unknown shape");
    return null;
  }

  const eventDirectory = typeof rawEvent.directory === "string" ? rawEvent.directory : null;
  if (eventDirectory && !isSameDirectory(eventDirectory, directory)) {
    return null;
  }

  if (!isEventLike(rawEvent.payload)) {
    logger.debug("[Events] Ignoring global event with unknown payload shape");
    return null;
  }

  return rawEvent.payload;
}

function normalizeEvent(rawEvent: unknown, source: EventStreamSource, directory: string): Event | null {
  if (source === "global") {
    return normalizeGlobalEvent(rawEvent, directory);
  }

  if (!isEventLike(rawEvent)) {
    logger.debug("[Events] Ignoring legacy event with unknown shape");
    return null;
  }

  return rawEvent;
}

async function subscribeToGlobalEventStream(signal: AbortSignal): Promise<EventStreamSubscription> {
  const globalEvents = (opencodeClient as OptionalGlobalEventClient).global;
  if (!globalEvents?.event) {
    throw new Error("Global event subscription is not available");
  }

  const result = await globalEvents.event({ signal });
  if (!result.stream) {
    throw new Error(FATAL_NO_STREAM_ERROR);
  }

  return { source: "global", stream: result.stream };
}

async function subscribeToLegacyEventStream(
  directory: string,
  signal: AbortSignal,
): Promise<EventStreamSubscription> {
  const result = await opencodeClient.event.subscribe({ directory }, { signal });
  if (!result.stream) {
    throw new Error(FATAL_NO_STREAM_ERROR);
  }

  return { source: "legacy", stream: result.stream };
}

async function dispatchEvent(worker: DirectoryStreamWorker, event: Event): Promise<void> {
  const callbacks = Array.from(worker.callbacks);
  for (const callback of callbacks) {
    try {
      await callback(event);
    } catch (error) {
      logger.error(
        "[Events] Event callback failed",
        { directory: worker.directory, eventType: event.type },
        error,
      );
    }
  }
}

async function runWorkerLoop(worker: DirectoryStreamWorker): Promise<void> {
  let reconnectAttempt = 0;
  let useLegacyEventsOnce = false;
  const { directory, abortController } = worker;

  while (!abortController.signal.aborted && worker.callbacks.size > 0) {
    let attemptAbort: ReturnType<typeof createAttemptAbortController> | null = null;

    try {
      let subscription: EventStreamSubscription;
      attemptAbort = createAttemptAbortController(abortController.signal);

      if (useLegacyEventsOnce) {
        useLegacyEventsOnce = false;
        subscription = await subscribeToLegacyEventStream(directory, attemptAbort.controller.signal);
      } else {
        try {
          subscription = await subscribeToGlobalEventStream(attemptAbort.controller.signal);
          logger.debug(`[Events] Using global OpenCode event stream for ${directory}`);
        } catch (error) {
          if (abortController.signal.aborted || worker.callbacks.size === 0) {
            throw error;
          }

          if (isExpectedOpencodeUnavailableError(error)) {
            throw error;
          }

          logger.warn(
            `[Events] Global event stream unavailable for ${directory}, falling back to project event stream`,
            error,
          );
          subscription = await subscribeToLegacyEventStream(directory, attemptAbort.controller.signal);
        }
      }

      reconnectAttempt = 0;
      let usefulEventCount = 0;

      try {
        while (!abortController.signal.aborted && worker.callbacks.size > 0) {
          const readResult = await readStreamWithIdleTimeout(
            subscription.stream,
            attemptAbort.controller.signal,
          );

          if (readResult.type === "aborted") {
            break;
          }

          if (readResult.type === "timeout") {
            attemptAbort.controller.abort();
            const closeStream = subscription.stream.return?.(undefined);
            void closeStream?.catch(() => undefined);
            throw new Error(SSE_IDLE_TIMEOUT_ERROR);
          }

          if (readResult.type === "error") {
            throw readResult.error;
          }

          if (readResult.result.done) {
            break;
          }

          await new Promise<void>((resolve) => setImmediate(resolve));

          const normalizedEvent = normalizeEvent(readResult.result.value, subscription.source, directory);
          if (!normalizedEvent) {
            continue;
          }

          if (normalizedEvent.type !== "server.connected") {
            usefulEventCount++;
          }

          await dispatchEvent(worker, normalizedEvent);
        }
      } finally {
        attemptAbort.cleanup();
        attemptAbort = null;
      }

      if (abortController.signal.aborted || worker.callbacks.size === 0) {
        break;
      }

      if (subscription.source === "global" && usefulEventCount === 0) {
        useLegacyEventsOnce = true;
        logger.warn(
          `[Events] Global event stream ended without project events for ${directory}, falling back to project event stream`,
        );
        continue;
      }

      reconnectAttempt++;
      const reconnectDelay = getReconnectDelayMs(reconnectAttempt);
      logger.warn(`[Events] Stream ended, reconnecting`, {
        directory,
        reconnectAttempt,
        reconnectDelay,
      });

      const shouldContinue = await waitWithAbort(reconnectDelay, abortController.signal);
      if (!shouldContinue) {
        break;
      }
    } catch (error) {
      if (abortController.signal.aborted || worker.callbacks.size === 0) {
        break;
      }

      attemptAbort?.cleanup();

      if (error instanceof Error && error.message === FATAL_NO_STREAM_ERROR) {
        logger.error("[Events] Fatal event stream error", { directory }, error);
        break;
      }

      reconnectAttempt++;
      const reconnectDelay = getReconnectDelayMs(reconnectAttempt);

      if (isEventStreamIdleTimeoutError(error)) {
        logger.warn(`[Events] Stream idle timeout, reconnecting`, {
          directory,
          reconnectAttempt,
          reconnectDelay,
        });
      } else {
        logger.error(
          `[Events] Stream failed, reconnecting`,
          { directory, reconnectAttempt, reconnectDelay },
          error,
        );
      }

      const shouldContinue = await waitWithAbort(reconnectDelay, abortController.signal);
      if (!shouldContinue) {
        break;
      }
    }
  }
}

function ensureWorkerStarted(worker: DirectoryStreamWorker): void {
  if (worker.loopPromise) {
    return;
  }

  worker.loopPromise = runWorkerLoop(worker)
    .catch((error) => {
      logger.error(
        "[Events] Worker loop failed unexpectedly",
        { directory: worker.directory },
        error,
      );
    })
    .finally(() => {
      worker.loopPromise = null;
      if (worker.callbacks.size === 0 || worker.abortController.signal.aborted) {
        workersByDirectory.delete(worker.directory);
      }
    });
}

export async function subscribeToEvents(directory: string, callback: EventCallback): Promise<void> {
  const worker = getOrCreateWorker(directory);
  worker.callbacks.add(callback);
  ensureWorkerStarted(worker);
}

export function unsubscribeFromEvents(directory: string, callback: EventCallback): void {
  const worker = workersByDirectory.get(directory);
  if (!worker) {
    return;
  }

  worker.callbacks.delete(callback);
  if (worker.callbacks.size > 0) {
    return;
  }

  worker.abortController.abort();
  workersByDirectory.delete(directory);
}

export function stopEventListening(directory?: string): void {
  if (directory) {
    const worker = workersByDirectory.get(directory);
    if (!worker) {
      return;
    }

    worker.abortController.abort();
    workersByDirectory.delete(directory);
    logger.info("[Events] Stopped event listener", { directory });
    return;
  }

  for (const [workerDirectory, worker] of workersByDirectory.entries()) {
    worker.abortController.abort();
    workersByDirectory.delete(workerDirectory);
  }

  logger.info("[Events] Stopped all event listeners");
}

export function __setSseIdleTimeoutForTests(timeoutMs: number): void {
  sseIdleTimeoutMs = timeoutMs;
}
