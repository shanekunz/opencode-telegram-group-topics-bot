import { buildThinkingMessage, hasOnlyThinkingLine } from "../utils/thinking-message.js";
import { logger } from "../../utils/logger.js";

const DEFAULT_THROTTLE_MS = 250;

interface ToolCallStreamerOptions {
  sendText: (sessionId: string, text: string) => Promise<number | null>;
  editText: (sessionId: string, messageId: number, text: string) => Promise<void>;
  deleteMessage: (sessionId: string, messageId: number) => Promise<void>;
  throttleMs?: number;
}

interface ToolCallState {
  messageId: number | null;
  thinkingText: string | null;
  updates: string[];
  lastSentText: string;
}

export class ToolCallStreamer {
  private readonly sendText;
  private readonly editText;
  private readonly deleteMessage;
  private readonly throttleMs: number;
  private readonly states = new Map<string, ToolCallState>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly sessionTasks = new Map<string, Promise<void>>();

  constructor(options: ToolCallStreamerOptions) {
    this.sendText = options.sendText;
    this.editText = options.editText;
    this.deleteMessage = options.deleteMessage;
    this.throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  }

  showThinking(sessionId: string, text: string): void {
    if (!sessionId || !text.trim()) {
      return;
    }

    const state = this.getOrCreateState(sessionId);
    state.thinkingText = text.trim();
    this.scheduleFlush(sessionId);
  }

  pushUpdate(sessionId: string, text: string): void {
    const normalizedText = text.trim();
    if (!sessionId || !normalizedText) {
      return;
    }

    const state = this.getOrCreateState(sessionId);
    if (state.updates[state.updates.length - 1] === normalizedText) {
      return;
    }

    state.updates.push(normalizedText);
    this.scheduleFlush(sessionId);
  }

  replaceByPrefix(sessionId: string, prefix: string, text: string): void {
    const normalizedPrefix = prefix.trim();
    if (!sessionId || !normalizedPrefix) {
      return;
    }

    const normalizedText = text.trim();
    const state = this.getOrCreateState(sessionId);
    state.updates = state.updates.filter((update) => !update.startsWith(normalizedPrefix));

    if (normalizedText) {
      state.updates.push(normalizedText);
    }

    this.scheduleFlush(sessionId);
  }

  dismissThinking(sessionId: string): void {
    const state = this.states.get(sessionId);
    if (!state || !state.thinkingText) {
      return;
    }

    state.thinkingText = null;

    if (state.updates.length === 0) {
      void this.clearSession(sessionId, "thinking_dismissed");
      return;
    }

    this.scheduleFlush(sessionId);
  }

  async clearSession(sessionId: string, reason: string): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state) {
      return;
    }

    logger.debug(
      `[ToolCallStreamer] Clearing session stream: session=${sessionId}, reason=${reason}`,
    );
    this.clearTimer(sessionId);
    await this.enqueueTask(sessionId, async () => {
      if (state.messageId !== null) {
        await this.deleteMessageSafe(sessionId, state.messageId);
      }
    });
    this.states.delete(sessionId);
  }

  async clearAll(reason: string): Promise<void> {
    for (const sessionId of Array.from(this.states.keys())) {
      await this.clearSession(sessionId, reason);
    }
  }

  async clearThinkingOnlySession(sessionId: string): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state || !hasOnlyThinkingLine(state.thinkingText, state.updates)) {
      return;
    }

    await this.clearSession(sessionId, "thinking_only_session_cleared");
  }

  private getOrCreateState(sessionId: string): ToolCallState {
    const existing = this.states.get(sessionId);
    if (existing) {
      return existing;
    }

    const state: ToolCallState = {
      messageId: null,
      thinkingText: null,
      updates: [],
      lastSentText: "",
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
      void this.enqueueTask(sessionId, () => this.flushSessionState(sessionId));
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

  private async flushSessionState(sessionId: string): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state) {
      return;
    }

    const text = buildThinkingMessage(state.thinkingText, state.updates);
    if (!text) {
      if (state.messageId !== null) {
        await this.deleteMessageSafe(sessionId, state.messageId);
      }
      this.states.delete(sessionId);
      return;
    }

    if (state.messageId === null) {
      try {
        const messageId = await this.sendText(sessionId, text);
        if (messageId === null) {
          return;
        }

        state.messageId = messageId;
        state.lastSentText = text;
        return;
      } catch (error) {
        logger.warn("[ToolCallStreamer] Failed to send tool stream message", {
          sessionId,
          error,
        });
        return;
      }
    }

    if (state.lastSentText === text) {
      return;
    }

    try {
      await this.editText(sessionId, state.messageId, text);
      state.lastSentText = text;
    } catch (error) {
      logger.warn("[ToolCallStreamer] Failed to edit tool stream message", {
        sessionId,
        error,
      });
    }
  }

  private async deleteMessageSafe(sessionId: string, messageId: number): Promise<void> {
    try {
      await this.deleteMessage(sessionId, messageId);
    } catch (error) {
      logger.debug("[ToolCallStreamer] Failed to delete tool stream message", {
        sessionId,
        messageId,
        error,
      });
    }
  }
}
