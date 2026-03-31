import type { TelegramTextFormat } from "../utils/telegram-text.js";
import { logger } from "../../utils/logger.js";

const DEFAULT_THROTTLE_MS = 350;

interface ResponseStreamerOptions {
  sendText: (sessionId: string, text: string, format: TelegramTextFormat) => Promise<number | null>;
  editText: (
    sessionId: string,
    messageId: number,
    text: string,
    format: TelegramTextFormat,
    includeKeyboard: boolean,
  ) => Promise<void>;
  deleteMessage: (sessionId: string, messageId: number) => Promise<void>;
  throttleMs?: number;
}

interface StreamState {
  messageId: number | null;
  latestText: string;
  lastSentText: string;
  format: TelegramTextFormat;
  fallbackOnly: boolean;
}

export class ResponseStreamer {
  private readonly sendText;
  private readonly editText;
  private readonly deleteMessage;
  private readonly throttleMs: number;
  private readonly states = new Map<string, StreamState>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly sessionTasks = new Map<string, Promise<void>>();

  constructor(options: ResponseStreamerOptions) {
    this.sendText = options.sendText;
    this.editText = options.editText;
    this.deleteMessage = options.deleteMessage;
    this.throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  }

  async update(sessionId: string, text: string, format: TelegramTextFormat): Promise<void> {
    const normalizedText = text.trim();
    if (!sessionId || !normalizedText) {
      return;
    }

    const state = this.getOrCreateState(sessionId, format);
    if (state.fallbackOnly) {
      return;
    }

    state.latestText = normalizedText;
    state.format = format;

    if (state.messageId === null) {
      await this.enqueueTask(sessionId, () => this.flushSessionState(sessionId, false));
      return;
    }

    this.scheduleFlush(sessionId);
  }

  markFallback(sessionId: string): void {
    const state = this.states.get(sessionId);
    if (!state) {
      return;
    }

    state.fallbackOnly = true;
    this.clearTimer(sessionId);
  }

  async finalize(sessionId: string, text: string, format: TelegramTextFormat): Promise<boolean> {
    const normalizedText = text.trim();
    const state = this.states.get(sessionId);

    if (!state) {
      return false;
    }

    this.clearTimer(sessionId);

    if (state.fallbackOnly || !normalizedText) {
      await this.deleteStreamedMessage(sessionId, state.messageId);
      this.states.delete(sessionId);
      return false;
    }

    state.latestText = normalizedText;
    state.format = format;

    const handled = await this.enqueueTask(sessionId, async () => {
      const sent = await this.flushSessionState(sessionId, true);
      if (!sent) {
        const nextState = this.states.get(sessionId);
        await this.deleteStreamedMessage(sessionId, nextState?.messageId ?? null);
      }
      return sent;
    });

    this.states.delete(sessionId);
    return handled;
  }

  async resetForFinalDelivery(sessionId: string): Promise<boolean> {
    const state = this.states.get(sessionId);
    if (!state) {
      return false;
    }

    this.clearTimer(sessionId);
    await this.enqueueTask(sessionId, async () => {
      await this.deleteStreamedMessage(sessionId, state.messageId);
      return false;
    });
    this.states.delete(sessionId);
    return state.messageId !== null;
  }

  async clearSession(sessionId: string, reason: string): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state) {
      return;
    }

    logger.debug(
      `[ResponseStreamer] Clearing session stream: session=${sessionId}, reason=${reason}`,
    );
    this.clearTimer(sessionId);
    await this.enqueueTask(sessionId, async () => {
      await this.deleteStreamedMessage(sessionId, state.messageId);
      return false;
    });
    this.states.delete(sessionId);
  }

  async clearAll(reason: string): Promise<void> {
    for (const sessionId of Array.from(this.states.keys())) {
      await this.clearSession(sessionId, reason);
    }
  }

  private getOrCreateState(sessionId: string, format: TelegramTextFormat): StreamState {
    const existing = this.states.get(sessionId);
    if (existing) {
      return existing;
    }

    const state: StreamState = {
      messageId: null,
      latestText: "",
      lastSentText: "",
      format,
      fallbackOnly: false,
    };
    this.states.set(sessionId, state);
    return state;
  }

  private clearTimer(sessionId: string): void {
    const timer = this.timers.get(sessionId);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.timers.delete(sessionId);
  }

  private scheduleFlush(sessionId: string): void {
    if (this.timers.has(sessionId)) {
      return;
    }

    const timer = setTimeout(() => {
      this.timers.delete(sessionId);
      void this.enqueueTask(sessionId, () => this.flushSessionState(sessionId, false));
    }, this.throttleMs);

    this.timers.set(sessionId, timer);
  }

  private enqueueTask<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previousTask = this.sessionTasks.get(sessionId) ?? Promise.resolve();
    const nextTask = previousTask
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        if (this.sessionTasks.get(sessionId) === nextTask) {
          this.sessionTasks.delete(sessionId);
        }
      });

    this.sessionTasks.set(
      sessionId,
      nextTask.then(() => undefined),
    );
    return nextTask;
  }

  private async flushSessionState(sessionId: string, includeKeyboard: boolean): Promise<boolean> {
    const state = this.states.get(sessionId);
    if (!state || state.fallbackOnly || !state.latestText) {
      return false;
    }

    if (state.messageId === null) {
      try {
        const messageId = await this.sendText(sessionId, state.latestText, state.format);
        if (messageId === null) {
          return false;
        }

        state.messageId = messageId;
        state.lastSentText = state.latestText;
        return true;
      } catch (error) {
        logger.warn("[ResponseStreamer] Failed to send streamed assistant message", {
          sessionId,
          error,
        });
        return false;
      }
    }

    if (state.lastSentText === state.latestText && !includeKeyboard) {
      return true;
    }

    try {
      await this.editText(
        sessionId,
        state.messageId,
        state.latestText,
        state.format,
        includeKeyboard,
      );
      state.lastSentText = state.latestText;
      return true;
    } catch (error) {
      logger.warn("[ResponseStreamer] Failed to edit streamed assistant message", {
        sessionId,
        error,
      });
      return false;
    }
  }

  private async deleteStreamedMessage(sessionId: string, messageId: number | null): Promise<void> {
    if (messageId === null) {
      return;
    }

    try {
      await this.deleteMessage(sessionId, messageId);
    } catch (error) {
      logger.debug("[ResponseStreamer] Failed to delete streamed assistant message", {
        sessionId,
        messageId,
        error,
      });
    }
  }
}
