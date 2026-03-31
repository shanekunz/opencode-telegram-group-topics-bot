import { buildThinkingMessage, hasOnlyThinkingLine } from "../utils/thinking-message.js";
import { logger } from "../../utils/logger.js";
import type { TelegramTextFormat } from "../utils/telegram-text.js";
import { getTelegramRetryAfterMs } from "../utils/send-with-markdown-fallback.js";

const DEFAULT_THROTTLE_MS = 1000;
const TELEGRAM_MESSAGE_LIMIT = 4096;
const THINKING_PREFIX = "__thinking__";
const MAX_REPLACEABLE_SERVICE_LENGTH = 3500;

interface LiveStreamOptions {
  sendText: (
    sessionId: string,
    text: string,
    format?: TelegramTextFormat,
    includeKeyboard?: boolean,
  ) => Promise<number | null>;
  editText: (
    sessionId: string,
    messageId: number,
    text: string,
    format?: TelegramTextFormat,
    includeKeyboard?: boolean,
  ) => Promise<void>;
  deleteText?: (sessionId: string, messageId: number) => Promise<void>;
  throttleMs?: number;
}

interface AssistantEntry {
  kind: "assistant";
  messageId: string;
  text: string;
  startOffset: number;
  endOffset: number;
}

interface ServiceEntry {
  kind: "service";
  text: string;
  replaceKey?: string;
}

type StreamEntry = AssistantEntry | ServiceEntry;

interface AssistantState {
  messageId: string | null;
  fullText: string;
  committedLength: number;
  replaySuppressionPrefix: string | null;
}

interface ServiceState {
  thinkingText: string | null;
  updates: string[];
}

interface SessionState {
  messageId: number | null;
  lastSentText: string;
  entries: StreamEntry[];
  assistant: AssistantState;
  service: ServiceState;
}

function renderEntries(entries: StreamEntry[]): string {
  return entries
    .map((entry) => entry.text.trim())
    .filter((text) => text.length > 0)
    .join("\n\n")
    .trim();
}

function splitLongText(text: string, limit: number): [string, string] {
  if (text.length <= limit) {
    return [text, ""];
  }

  let splitIndex = text.lastIndexOf("\n", limit);
  if (splitIndex <= 0 || splitIndex < Math.floor(limit * 0.5)) {
    splitIndex = limit;
  }

  const prefix = text.slice(0, splitIndex).trimEnd();
  const suffix = text.slice(splitIndex).replace(/^\n+/, "").trimStart();
  return [prefix, suffix];
}

function getTrimmedRange(
  text: string,
  baseOffset: number,
): { text: string; start: number; end: number } {
  const trimmedStart = text.trimStart();
  if (!trimmedStart) {
    return { text: "", start: baseOffset, end: baseOffset };
  }

  const leadingLength = text.length - trimmedStart.length;
  const trimmed = trimmedStart.trimEnd();
  const trailingLength = trimmedStart.length - trimmed.length;
  const start = baseOffset + leadingLength;
  const end = baseOffset + text.length - trailingLength;
  return {
    text: trimmed,
    start,
    end,
  };
}

function splitAssistantEntry(
  entry: AssistantEntry,
  limit: number,
): [AssistantEntry, AssistantEntry | null] {
  const [prefixSourceText, suffixSourceText] = splitLongText(entry.text, limit);
  if (!suffixSourceText) {
    return [entry, null];
  }

  const prefixRange = getTrimmedRange(prefixSourceText, entry.startOffset);
  const suffixBaseOffset = entry.endOffset - suffixSourceText.length;
  const suffixRange = getTrimmedRange(suffixSourceText, suffixBaseOffset);

  return [
    {
      kind: "assistant",
      messageId: entry.messageId,
      text: prefixRange.text,
      startOffset: prefixRange.start,
      endOffset: prefixRange.end,
    },
    {
      kind: "assistant",
      messageId: entry.messageId,
      text: suffixRange.text,
      startOffset: suffixRange.start,
      endOffset: suffixRange.end,
    },
  ];
}

function splitServiceEntry(
  entry: ServiceEntry,
  limit: number,
): [ServiceEntry, ServiceEntry | null] {
  const [prefixText, suffixText] = splitLongText(entry.text, limit);
  if (!suffixText) {
    return [entry, null];
  }

  return [
    {
      kind: "service",
      text: prefixText,
      replaceKey: entry.replaceKey,
    },
    {
      kind: "service",
      text: suffixText,
      replaceKey: entry.replaceKey,
    },
  ];
}

function splitEntriesForLimit(entries: StreamEntry[]): {
  sentEntries: StreamEntry[];
  remainingEntries: StreamEntry[];
} {
  const sentEntries: StreamEntry[] = [];

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const candidateText = renderEntries([...sentEntries, entry]);
    if (candidateText.length <= TELEGRAM_MESSAGE_LIMIT) {
      sentEntries.push(entry);
      continue;
    }

    if (sentEntries.length > 0) {
      return {
        sentEntries,
        remainingEntries: entries.slice(index),
      };
    }

    const [prefixEntry, suffixEntry] =
      entry.kind === "assistant"
        ? splitAssistantEntry(entry, TELEGRAM_MESSAGE_LIMIT)
        : splitServiceEntry(entry, TELEGRAM_MESSAGE_LIMIT);

    return {
      sentEntries: [prefixEntry],
      remainingEntries: suffixEntry
        ? [suffixEntry, ...entries.slice(index + 1)]
        : entries.slice(index + 1),
    };
  }

  return {
    sentEntries,
    remainingEntries: [],
  };
}

export class LiveStream {
  private readonly sendText;
  private readonly editText;
  private readonly deleteText;
  private readonly throttleMs: number;
  private readonly states = new Map<string, SessionState>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly sessionTasks = new Map<string, Promise<void>>();

  constructor(options: LiveStreamOptions) {
    this.sendText = options.sendText;
    this.editText = options.editText;
    this.deleteText = options.deleteText;
    this.throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  }

  async updateAssistant(
    sessionId: string,
    assistantMessageId: string,
    text: string,
  ): Promise<void> {
    const normalizedText = text.trim();
    if (!sessionId || !assistantMessageId || !normalizedText) {
      return;
    }

    this.applyMutation(sessionId, (state) => {
      this.syncAssistantEntry(state, assistantMessageId, normalizedText);
    });
  }

  async completeAssistant(
    sessionId: string,
    assistantMessageId: string,
    text: string,
  ): Promise<void> {
    const normalizedText = text.trim();
    if (!sessionId || !assistantMessageId || !normalizedText) {
      return;
    }

    this.applyMutation(sessionId, (state) => {
      this.syncAssistantEntry(state, assistantMessageId, normalizedText);
      if (state.assistant.messageId === assistantMessageId) {
        state.assistant.fullText = normalizedText;
      }
    });
  }

  showThinking(sessionId: string, text: string): void {
    if (!sessionId || !text.trim()) {
      return;
    }

    this.applyMutation(sessionId, (state) => {
      state.service.thinkingText = text.trim();
      this.syncThinkingEntry(state);
    });
  }

  pushServiceUpdate(sessionId: string, text: string): void {
    const normalizedText = text.trim();
    if (!sessionId || !normalizedText) {
      return;
    }

    this.applyMutation(sessionId, (state) => {
      if (state.service.updates[state.service.updates.length - 1] !== normalizedText) {
        state.service.updates.push(normalizedText);
      }

      state.entries.push({ kind: "service", text: normalizedText });
    });
  }

  replaceServiceByPrefix(sessionId: string, prefix: string, text: string): void {
    const normalizedPrefix = prefix.trim();
    if (!sessionId || !normalizedPrefix) {
      return;
    }

    this.applyMutation(sessionId, (state) => {
      state.service.updates = state.service.updates.filter(
        (update) => !update.startsWith(normalizedPrefix),
      );

      const normalizedText = text.trim();
      const existingIndex = state.entries.findIndex(
        (entry) => entry.kind === "service" && entry.replaceKey === normalizedPrefix,
      );

      const truncatedText =
        normalizedText.length > MAX_REPLACEABLE_SERVICE_LENGTH
          ? `${normalizedText.slice(0, MAX_REPLACEABLE_SERVICE_LENGTH - 3)}...`
          : normalizedText;

      if (!normalizedText) {
        if (existingIndex >= 0) {
          state.entries.splice(existingIndex, 1);
        }
        return;
      }

      state.service.updates.push(truncatedText);
      const nextEntry: ServiceEntry = {
        kind: "service",
        text: truncatedText,
        replaceKey: normalizedPrefix,
      };

      if (existingIndex >= 0) {
        state.entries[existingIndex] = nextEntry;
      } else {
        state.entries.push(nextEntry);
      }
    });
  }

  async clearThinkingOnlySession(sessionId: string): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state || !hasOnlyThinkingLine(state.service.thinkingText, state.service.updates)) {
      return;
    }

    this.applyMutation(sessionId, (nextState) => {
      nextState.service.thinkingText = null;
      this.syncThinkingEntry(nextState);
    });
  }

  async sealCurrentMessage(
    sessionId: string,
    resetAssistantState: boolean = false,
    suppressAssistantReplay: boolean = false,
  ): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state) {
      return;
    }

    this.clearTimer(sessionId);
    await this.enqueueTask(sessionId, async () => {
      await this.flushSessionState(sessionId);
    });

    const visibleAssistantText = state.entries
      .filter((entry): entry is AssistantEntry => entry.kind === "assistant")
      .map((entry) => entry.text)
      .join("\n\n")
      .trim();

    state.messageId = null;
    state.lastSentText = "";
    state.entries = [];
    state.service = { thinkingText: null, updates: [] };

    if (resetAssistantState) {
      state.assistant = {
        messageId: null,
        fullText: "",
        committedLength: 0,
        replaySuppressionPrefix: null,
      };
      return;
    }

    if (state.assistant.messageId) {
      state.assistant.committedLength = state.assistant.fullText.length;
    }

    state.assistant.replaySuppressionPrefix =
      suppressAssistantReplay && visibleAssistantText ? visibleAssistantText : null;
  }

  async flushSession(sessionId: string): Promise<void> {
    if (!this.states.has(sessionId)) {
      return;
    }

    this.clearTimer(sessionId);
    await this.enqueueTask(sessionId, async () => {
      await this.flushSessionState(sessionId);
    });
  }

  async finalizeCurrentMessage(
    sessionId: string,
    options: { format: TelegramTextFormat; includeKeyboard: boolean },
  ): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state || state.messageId === null) {
      return;
    }

    this.clearTimer(sessionId);
    await this.enqueueTask(sessionId, async () => {
      await this.flushSessionState(sessionId);

      const latestState = this.states.get(sessionId);
      if (!latestState || latestState.messageId === null) {
        return;
      }

      const text = renderEntries(latestState.entries);
      if (!text) {
        return;
      }

      const format = this.canUseAssistantFormat(latestState) ? options.format : "raw";
      await this.editText(sessionId, latestState.messageId, text, format, options.includeKeyboard);
      latestState.lastSentText = text;
    });
  }

  async cleanupAfterFinalDelivery(sessionId: string): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state) {
      return;
    }

    this.clearTimer(sessionId);
    await this.enqueueTask(sessionId, async () => {
      await this.flushSessionState(sessionId);

      const latestState = this.states.get(sessionId);
      if (!latestState || latestState.messageId === null) {
        return;
      }

      const hasAssistantEntry = latestState.entries.some((entry) => entry.kind === "assistant");
      if (!hasAssistantEntry) {
        return;
      }

      const remainingEntries = latestState.entries.filter((entry) => entry.kind !== "assistant");
      const remainingText = renderEntries(remainingEntries);

      if (!remainingText) {
        if (this.deleteText) {
          await this.deleteText(sessionId, latestState.messageId);
        }
        latestState.messageId = null;
        latestState.lastSentText = "";
        latestState.entries = [];
        return;
      }

      if (latestState.lastSentText === remainingText) {
        latestState.entries = remainingEntries;
        return;
      }

      await this.editText(sessionId, latestState.messageId, remainingText, "raw", false);
      latestState.entries = remainingEntries;
      latestState.lastSentText = remainingText;
    });
  }

  async clearSession(sessionId: string, reason: string): Promise<void> {
    if (!this.states.has(sessionId)) {
      return;
    }

    logger.debug(`[LiveStream] Clearing session state: session=${sessionId}, reason=${reason}`);
    this.clearTimer(sessionId);
    await this.enqueueTask(sessionId, async () => undefined);
    this.states.delete(sessionId);
  }

  async clearAll(reason: string): Promise<void> {
    for (const sessionId of Array.from(this.states.keys())) {
      await this.clearSession(sessionId, reason);
    }
  }

  private getOrCreateState(sessionId: string): SessionState {
    const existing = this.states.get(sessionId);
    if (existing) {
      return existing;
    }

    const state: SessionState = {
      messageId: null,
      lastSentText: "",
      entries: [],
      assistant: {
        messageId: null,
        fullText: "",
        committedLength: 0,
        replaySuppressionPrefix: null,
      },
      service: {
        thinkingText: null,
        updates: [],
      },
    };
    this.states.set(sessionId, state);
    return state;
  }

  private syncAssistantEntry(
    state: SessionState,
    assistantMessageId: string,
    fullText: string,
  ): void {
    if (state.assistant.messageId !== assistantMessageId) {
      state.assistant = {
        messageId: assistantMessageId,
        fullText,
        committedLength: 0,
        replaySuppressionPrefix: state.assistant.replaySuppressionPrefix,
      };
    } else {
      state.assistant.fullText = fullText;
    }

    if (state.assistant.committedLength > fullText.length) {
      state.assistant.committedLength = 0;
    }

    const rawSuffix = fullText.slice(state.assistant.committedLength);
    const visibleRange = getTrimmedRange(rawSuffix, state.assistant.committedLength);
    const existingIndex = state.entries.findIndex(
      (entry) => entry.kind === "assistant" && entry.messageId === assistantMessageId,
    );

    if (!visibleRange.text) {
      if (existingIndex >= 0) {
        state.entries.splice(existingIndex, 1);
      }
      return;
    }

    const nextEntry: AssistantEntry = {
      kind: "assistant",
      messageId: assistantMessageId,
      text: visibleRange.text,
      startOffset: visibleRange.start,
      endOffset: visibleRange.end,
    };

    const suppressionPrefix = state.assistant.replaySuppressionPrefix;
    if (suppressionPrefix && nextEntry.text.startsWith(suppressionPrefix)) {
      const trimmedText = nextEntry.text.slice(suppressionPrefix.length).trimStart();
      const consumedChars = nextEntry.text.length - trimmedText.length;
      state.assistant.replaySuppressionPrefix = null;

      if (!trimmedText) {
        if (existingIndex >= 0) {
          state.entries.splice(existingIndex, 1);
        }
        return;
      }

      nextEntry.text = trimmedText;
      nextEntry.startOffset += consumedChars;
    }

    if (existingIndex >= 0) {
      state.entries[existingIndex] = nextEntry;
      return;
    }

    state.entries.push(nextEntry);
  }

  private syncThinkingEntry(state: SessionState): void {
    const thinkingText = buildThinkingMessage(state.service.thinkingText, []);
    const existingIndex = state.entries.findIndex(
      (entry) => entry.kind === "service" && entry.replaceKey === THINKING_PREFIX,
    );

    if (!thinkingText) {
      if (existingIndex >= 0) {
        state.entries.splice(existingIndex, 1);
      }
      return;
    }

    const nextEntry: ServiceEntry = {
      kind: "service",
      text: thinkingText,
      replaceKey: THINKING_PREFIX,
    };

    if (existingIndex >= 0) {
      state.entries[existingIndex] = nextEntry;
      return;
    }

    state.entries.push(nextEntry);
  }

  private applyMutation(sessionId: string, mutate: (state: SessionState) => void): void {
    const state = this.getOrCreateState(sessionId);
    mutate(state);
    this.scheduleFlush(sessionId);
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

  private scheduleRetryFlush(sessionId: string, retryAfterMs: number): void {
    this.clearTimer(sessionId);

    const timer = setTimeout(() => {
      this.timers.delete(sessionId);
      void this.enqueueTask(sessionId, () => this.flushSessionState(sessionId));
    }, retryAfterMs);

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

  private commitAssistantProgress(state: SessionState, sentEntries: StreamEntry[]): void {
    for (const entry of sentEntries) {
      if (entry.kind !== "assistant") {
        continue;
      }

      if (state.assistant.messageId !== entry.messageId) {
        continue;
      }

      state.assistant.committedLength = Math.min(state.assistant.fullText.length, entry.endOffset);
    }
  }

  private canUseAssistantFormat(state: SessionState): boolean {
    return (
      state.entries.length === 1 &&
      state.entries[0]?.kind === "assistant" &&
      state.entries[0].messageId === state.assistant.messageId
    );
  }

  private async flushSessionState(sessionId: string): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state) {
      return;
    }

    while (true) {
      const text = renderEntries(state.entries);
      if (!text) {
        return;
      }

      if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
        if (state.messageId === null) {
          try {
            const messageId = await this.sendText(sessionId, text, "raw", false);
            if (messageId === null) {
              return;
            }

            state.messageId = messageId;
            state.lastSentText = text;
            return;
          } catch (error) {
            const retryAfterMs = getTelegramRetryAfterMs(error);
            if (retryAfterMs) {
              logger.info(
                `[LiveStream] Telegram rate limit; retrying stream send in ${retryAfterMs}ms`,
                {
                  sessionId,
                },
              );
              this.scheduleRetryFlush(sessionId, retryAfterMs + 100);
              return;
            }

            logger.warn("[LiveStream] Failed to send stream message", { sessionId, error });
            return;
          }
        }

        if (state.lastSentText === text) {
          return;
        }

        try {
          await this.editText(sessionId, state.messageId, text, "raw", false);
          state.lastSentText = text;
        } catch (error) {
          const retryAfterMs = getTelegramRetryAfterMs(error);
          if (retryAfterMs) {
            logger.info(
              `[LiveStream] Telegram rate limit; retrying stream edit in ${retryAfterMs}ms`,
              {
                sessionId,
              },
            );
            this.scheduleRetryFlush(sessionId, retryAfterMs + 100);
            return;
          }

          logger.warn("[LiveStream] Failed to edit stream message", { sessionId, error });
        }
        return;
      }

      const { sentEntries, remainingEntries } = splitEntriesForLimit(state.entries);
      const prefixText = renderEntries(sentEntries);
      if (!prefixText) {
        return;
      }

      try {
        if (state.messageId === null) {
          const messageId = await this.sendText(sessionId, prefixText, "raw", false);
          if (messageId === null) {
            return;
          }

          state.messageId = messageId;
        } else if (state.lastSentText !== prefixText) {
          await this.editText(sessionId, state.messageId, prefixText, "raw", false);
        }
      } catch (error) {
        const retryAfterMs = getTelegramRetryAfterMs(error);
        if (retryAfterMs) {
          logger.info(
            `[LiveStream] Telegram rate limit; retrying rolled stream sync in ${retryAfterMs}ms`,
            {
              sessionId,
            },
          );
          this.scheduleRetryFlush(sessionId, retryAfterMs + 100);
          return;
        }

        logger.warn("[LiveStream] Failed to sync rolled stream message", { sessionId, error });
        return;
      }

      state.lastSentText = prefixText;
      this.commitAssistantProgress(state, sentEntries);
      state.messageId = null;
      state.lastSentText = "";
      state.entries = remainingEntries;
    }
  }
}
