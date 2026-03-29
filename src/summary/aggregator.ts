import { Event, ToolState } from "@opencode-ai/sdk/v2";
import type { CodeFileData } from "./formatter.js";
import { normalizePathForDisplay, prepareCodeFile } from "./formatter.js";
import type { Question } from "../question/types.js";
import type { PermissionRequest } from "../permission/types.js";
import type { FileChange } from "../pinned/types.js";
import { logger } from "../utils/logger.js";
import { getSessionById } from "../session/manager.js";

export interface SummaryInfo {
  sessionId: string;
  text: string;
  messageCount: number;
  lastUpdated: number;
}

type MessageCompleteCallback = (sessionId: string, messageText: string) => void;
type MessageUpdatedCallback = (sessionId: string, messageText: string) => void;

export interface ToolInfo {
  sessionId: string;
  messageId: string;
  callId: string;
  tool: string;
  state: ToolState;
  input?: { [key: string]: unknown };
  title?: string;
  metadata?: { [key: string]: unknown };
  hasFileAttachment?: boolean;
}

export interface ToolFileInfo extends ToolInfo {
  hasFileAttachment: true;
  fileData: CodeFileData;
}

type ToolCallback = (toolInfo: ToolInfo) => void;

type ToolFileCallback = (fileInfo: ToolFileInfo) => void;

type QuestionCallback = (sessionId: string, questions: Question[], requestID: string) => void;

type QuestionErrorCallback = () => void;

type ThinkingCallback = (sessionId: string) => void;

type TypingIndicatorCallback = (sessionId: string) => void;

export interface TokensInfo {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

type TokensCallback = (sessionId: string, tokens: TokensInfo) => void;

type SessionCompactedCallback = (sessionId: string, directory: string) => void;
type SessionIdleCallback = (sessionId: string) => void;

type SessionErrorCallback = (sessionId: string, message: string) => void;

export interface SessionRetryInfo {
  sessionId: string;
  attempt?: number;
  message: string;
  next?: number;
}

type SessionRetryCallback = (retryInfo: SessionRetryInfo) => void;

export type SubagentStatus = "pending" | "running" | "completed" | "error";

export interface SubagentInfo {
  cardId: string;
  sessionId: string | null;
  parentSessionId: string;
  agent: string;
  description: string;
  prompt: string;
  command?: string;
  status: SubagentStatus;
  providerID?: string;
  modelID?: string;
  currentTool?: string;
  currentToolInput?: { [key: string]: unknown };
  currentToolTitle?: string;
  terminalMessage?: string;
  updatedAt: number;
}

type SubagentCallback = (sessionId: string, subagents: SubagentInfo[]) => void;

type PermissionCallback = (request: PermissionRequest) => void;

type SessionDiffCallback = (sessionId: string, diffs: FileChange[]) => void;

type FileChangeCallback = (change: FileChange, sessionId: string) => void;

type ClearedCallback = () => void;

interface PreparedToolFileContext {
  fileData: CodeFileData | null;
  fileChange: FileChange | null;
}

interface SubagentState extends SubagentInfo {
  hasSubtaskMetadata: boolean;
  hasTaskToolMetadata: boolean;
  hasSessionTitleMetadata: boolean;
  createdAt: number;
}

function extractFirstUpdatedFileFromTitle(title: string): string {
  for (const rawLine of title.split("\n")) {
    const line = rawLine.trim();
    if (line.length >= 3 && line[1] === " " && /[AMDURC]/.test(line[0])) {
      return line.slice(2).trim();
    }
  }
  return "";
}

function countDiffChangesFromText(text: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;

  for (const line of text.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions++;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      deletions++;
    }
  }

  return { additions, deletions };
}

function extractEventSessionId(event: Event): string | null {
  const eventWithProperties = event as Event & {
    properties?: {
      info?: { sessionID?: unknown };
      part?: { sessionID?: unknown };
      request?: { sessionID?: unknown };
      session?: { id?: unknown };
    };
  };

  if (typeof eventWithProperties.properties?.info?.sessionID === "string") {
    return eventWithProperties.properties.info.sessionID;
  }

  if (typeof eventWithProperties.properties?.part?.sessionID === "string") {
    return eventWithProperties.properties.part.sessionID;
  }

  if (typeof eventWithProperties.properties?.request?.sessionID === "string") {
    return eventWithProperties.properties.request.sessionID;
  }

  if (typeof eventWithProperties.properties?.session?.id === "string") {
    return eventWithProperties.properties.session.id;
  }

  return null;
}

class SummaryAggregator {
  private static readonly COMPLETION_DEBOUNCE_MS = 100;

  private trackedSessionIds: Set<string> = new Set();
  private currentMessageParts: Map<string, string[]> = new Map();
  private pendingParts: Map<string, string[]> = new Map();
  private messages: Map<string, { role: string; sessionId: string }> = new Map();
  private messageCount = 0;
  private lastUpdated = 0;
  private onCompleteCallback: MessageCompleteCallback | null = null;
  private onMessageUpdatedCallback: MessageUpdatedCallback | null = null;
  private onToolCallback: ToolCallback | null = null;
  private onToolFileCallback: ToolFileCallback | null = null;
  private onQuestionCallback: QuestionCallback | null = null;
  private onQuestionErrorCallback: QuestionErrorCallback | null = null;
  private onThinkingCallback: ThinkingCallback | null = null;
  private onTypingIndicatorCallback: TypingIndicatorCallback | null = null;
  private onTokensCallback: TokensCallback | null = null;
  private onSessionCompactedCallback: SessionCompactedCallback | null = null;
  private onSessionIdleCallback: SessionIdleCallback | null = null;
  private onSessionErrorCallback: SessionErrorCallback | null = null;
  private onSessionRetryCallback: SessionRetryCallback | null = null;
  private onSubagentCallback: SubagentCallback | null = null;
  private onPermissionCallback: PermissionCallback | null = null;
  private onSessionDiffCallback: SessionDiffCallback | null = null;
  private onFileChangeCallback: FileChangeCallback | null = null;
  private onClearedCallback: ClearedCallback | null = null;
  private processedToolStates: Set<string> = new Set();
  private thinkingFiredForMessages: Set<string> = new Set();
  private typingTimer: ReturnType<typeof setInterval> | null = null;
  private activeTypingSessions: Set<string> = new Set();
  private partHashes: Map<string, Set<string>> = new Map();
  private completionTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private stepFinishCosts: Map<string, number> = new Map();
  private lastStreamedMessageText: Map<string, string> = new Map();
  private trackedSessionParents: Map<string, string | null> = new Map();
  private subagentStates: Map<string, SubagentState> = new Map();
  private subagentOrderByParent: Map<string, string[]> = new Map();
  private subagentCardIdBySessionId: Map<string, string> = new Map();
  private pendingSubagentCardIdsByParent: Map<string, string[]> = new Map();
  private pendingChildSessionIdsByParent: Map<string, string[]> = new Map();
  private fallbackSubagentCardIdsByParent: Map<string, string[]> = new Map();

  private getMessageKey(sessionId: string, messageId: string): string {
    return `${sessionId}:${messageId}`;
  }

  private isTrackedSession(sessionId: string): boolean {
    return this.trackedSessionIds.has(sessionId);
  }

  private getParentSessionId(sessionId: string): string | null {
    if (this.trackedSessionIds.has(sessionId)) {
      return sessionId;
    }

    return this.trackedSessionParents.get(sessionId) ?? null;
  }

  private isTrackedChildSession(sessionId: string): boolean {
    const parentSessionId = this.trackedSessionParents.get(sessionId);
    return typeof parentSessionId === "string" && parentSessionId.length > 0;
  }

  private getQueue(map: Map<string, string[]>, parentSessionId: string): string[] {
    const existing = map.get(parentSessionId);
    if (existing) {
      return existing;
    }

    const queue: string[] = [];
    map.set(parentSessionId, queue);
    return queue;
  }

  private dequeue(map: Map<string, string[]>, parentSessionId: string): string | undefined {
    const queue = map.get(parentSessionId);
    if (!queue || queue.length === 0) {
      return undefined;
    }

    const value = queue.shift();
    if (queue.length === 0) {
      map.delete(parentSessionId);
    }

    return value;
  }

  private removeFromQueue(
    map: Map<string, string[]>,
    parentSessionId: string,
    value: string,
  ): void {
    const queue = map.get(parentSessionId);
    if (!queue) {
      return;
    }

    const index = queue.indexOf(value);
    if (index >= 0) {
      queue.splice(index, 1);
    }

    if (queue.length === 0) {
      map.delete(parentSessionId);
    }
  }

  setOnComplete(callback: MessageCompleteCallback): void {
    this.onCompleteCallback = callback;
  }

  setOnMessageUpdated(callback: MessageUpdatedCallback): void {
    this.onMessageUpdatedCallback = callback;
  }

  setOnTool(callback: ToolCallback): void {
    this.onToolCallback = callback;
  }

  setOnToolFile(callback: ToolFileCallback): void {
    this.onToolFileCallback = callback;
  }

  setOnQuestion(callback: QuestionCallback): void {
    this.onQuestionCallback = callback;
  }

  setOnQuestionError(callback: QuestionErrorCallback): void {
    this.onQuestionErrorCallback = callback;
  }

  setOnThinking(callback: ThinkingCallback): void {
    this.onThinkingCallback = callback;
  }

  setOnTypingIndicator(callback: TypingIndicatorCallback): void {
    this.onTypingIndicatorCallback = callback;
  }

  setOnTokens(callback: TokensCallback): void {
    this.onTokensCallback = callback;
  }

  setOnSessionCompacted(callback: SessionCompactedCallback): void {
    this.onSessionCompactedCallback = callback;
  }

  setOnSessionIdle(callback: SessionIdleCallback): void {
    this.onSessionIdleCallback = callback;
  }

  setOnSessionError(callback: SessionErrorCallback): void {
    this.onSessionErrorCallback = callback;
  }

  setOnSessionRetry(callback: SessionRetryCallback): void {
    this.onSessionRetryCallback = callback;
  }

  setOnSubagent(callback: SubagentCallback): void {
    this.onSubagentCallback = callback;
  }

  setOnPermission(callback: PermissionCallback): void {
    this.onPermissionCallback = callback;
  }

  setOnSessionDiff(callback: SessionDiffCallback): void {
    this.onSessionDiffCallback = callback;
  }

  setOnFileChange(callback: FileChangeCallback): void {
    this.onFileChangeCallback = callback;
  }

  setOnCleared(callback: ClearedCallback): void {
    this.onClearedCallback = callback;
  }

  private hasActiveMessageForSession(sessionId: string): boolean {
    for (const value of this.messages.values()) {
      if (value.sessionId === sessionId && value.role === "assistant") {
        return true;
      }
    }

    return false;
  }

  private emitTypingIndicators(): void {
    const callback = this.onTypingIndicatorCallback;
    if (!callback) {
      return;
    }

    for (const sessionId of this.activeTypingSessions) {
      try {
        callback(sessionId);
      } catch (error) {
        logger.error("[Aggregator] Typing callback failed", { sessionId }, error);
      }
    }
  }

  private startTypingIndicator(sessionId: string): void {
    this.activeTypingSessions.add(sessionId);

    if (this.typingTimer) {
      return;
    }

    this.emitTypingIndicators();
    this.typingTimer = setInterval(() => {
      this.emitTypingIndicators();
    }, 4000);
  }

  stopTypingIndicator(sessionId?: string): void {
    if (sessionId) {
      this.activeTypingSessions.delete(sessionId);
    } else {
      this.activeTypingSessions.clear();
    }

    if (!this.typingTimer || this.activeTypingSessions.size > 0) {
      return;
    }

    clearInterval(this.typingTimer);
    this.typingTimer = null;
  }

  processEvent(event: Event): void {
    try {
      // Log all question-related events for debugging
      if (event.type.startsWith("question.")) {
        logger.info(
          `[Aggregator] Question event: ${event.type}`,
          JSON.stringify(event.properties, null, 2),
        );
      }

      // Log all session-related events for debugging
      if (event.type.startsWith("session.")) {
        logger.debug(
          `[Aggregator] Session event: ${event.type}`,
          JSON.stringify(event.properties, null, 2),
        );
      }

      switch (event.type) {
        case "session.created":
        case "session.updated":
          this.handleSessionCreatedOrUpdated(
            event as Event & {
              type: "session.created" | "session.updated";
            },
          );
          break;
        case "message.updated":
          this.handleMessageUpdated(event);
          break;
        case "message.part.updated":
          this.handleMessagePartUpdated(event);
          break;
        case "session.status":
          this.handleSessionStatus(event);
          break;
        case "session.idle":
          this.handleSessionIdle(event);
          break;
        case "session.compacted":
          this.handleSessionCompacted(event);
          break;
        case "session.error":
          this.handleSessionError(event);
          break;
        case "question.asked":
          this.handleQuestionAsked(event);
          break;
        case "question.replied":
          logger.info(`[Aggregator] Question replied: requestID=${event.properties.requestID}`);
          break;
        case "question.rejected":
          logger.info(`[Aggregator] Question rejected: requestID=${event.properties.requestID}`);
          break;
        case "session.diff":
          this.handleSessionDiff(event);
          break;
        case "permission.asked":
          this.handlePermissionAsked(event);
          break;
        case "permission.replied":
          logger.info(`[Aggregator] Permission replied: requestID=${event.properties.requestID}`);
          break;
        default:
          logger.debug(`[Aggregator] Unhandled event type: ${event.type}`);
          break;
      }
    } catch (error) {
      logger.error(
        "[Aggregator] Failed to process event",
        {
          eventType: event.type,
          sessionId: extractEventSessionId(event),
        },
        error,
      );
    }
  }

  setSession(sessionId: string): void {
    this.trackedSessionIds.add(sessionId);
    this.trackedSessionParents.set(sessionId, null);
  }

  clearSession(sessionId: string): void {
    this.trackedSessionIds.delete(sessionId);
    this.trackedSessionParents.delete(sessionId);
    this.stopTypingIndicator(sessionId);

    for (const [messageKey, message] of this.messages.entries()) {
      if (message.sessionId !== sessionId) {
        continue;
      }

      this.messages.delete(messageKey);
      this.currentMessageParts.delete(messageKey);
      this.pendingParts.delete(messageKey);
      this.partHashes.delete(messageKey);
      this.stepFinishCosts.delete(messageKey);
      this.lastStreamedMessageText.delete(messageKey);
      this.thinkingFiredForMessages.delete(messageKey);
      this.clearCompletionTimer(messageKey);
    }

    for (const [trackedSessionId, parentSessionId] of Array.from(
      this.trackedSessionParents.entries(),
    )) {
      if (parentSessionId === sessionId) {
        this.trackedSessionParents.delete(trackedSessionId);
        this.subagentCardIdBySessionId.delete(trackedSessionId);
      }
    }

    this.clearSubagentsForParent(sessionId);
  }

  clear(): void {
    this.stopTypingIndicator();
    this.trackedSessionIds.clear();
    this.trackedSessionParents.clear();
    this.currentMessageParts.clear();
    this.pendingParts.clear();
    this.messages.clear();
    this.partHashes.clear();
    this.stepFinishCosts.clear();
    this.lastStreamedMessageText.clear();
    for (const timer of this.completionTimers.values()) {
      clearTimeout(timer);
    }
    this.completionTimers.clear();
    this.processedToolStates.clear();
    this.thinkingFiredForMessages.clear();
    this.subagentStates.clear();
    this.subagentOrderByParent.clear();
    this.subagentCardIdBySessionId.clear();
    this.pendingSubagentCardIdsByParent.clear();
    this.pendingChildSessionIdsByParent.clear();
    this.fallbackSubagentCardIdsByParent.clear();
    this.messageCount = 0;
    this.lastUpdated = 0;

    if (this.onClearedCallback) {
      try {
        this.onClearedCallback();
      } catch (err) {
        logger.error("[Aggregator] Error in clear callback:", err);
      }
    }
  }

  private clearSubagentsForParent(parentSessionId: string): void {
    const cardIds = this.subagentOrderByParent.get(parentSessionId) ?? [];

    for (const cardId of cardIds) {
      const subagent = this.subagentStates.get(cardId);
      if (subagent?.sessionId) {
        this.subagentCardIdBySessionId.delete(subagent.sessionId);
      }
      this.subagentStates.delete(cardId);
    }

    this.subagentOrderByParent.delete(parentSessionId);
    this.pendingSubagentCardIdsByParent.delete(parentSessionId);
    this.pendingChildSessionIdsByParent.delete(parentSessionId);
    this.fallbackSubagentCardIdsByParent.delete(parentSessionId);
  }

  private emitSubagentState(parentSessionId: string): void {
    if (!this.onSubagentCallback || !this.trackedSessionIds.has(parentSessionId)) {
      return;
    }

    const cardIds = this.subagentOrderByParent.get(parentSessionId) ?? [];
    const subagents = cardIds
      .map((cardId) => this.subagentStates.get(cardId))
      .filter((state): state is SubagentState => Boolean(state))
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((state) => ({
        cardId: state.cardId,
        sessionId: state.sessionId,
        parentSessionId: state.parentSessionId,
        agent: state.agent,
        description: state.description,
        prompt: state.prompt,
        command: state.command,
        status: state.status,
        providerID: state.providerID,
        modelID: state.modelID,
        currentTool: state.currentTool,
        currentToolInput: state.currentToolInput ? { ...state.currentToolInput } : undefined,
        currentToolTitle: state.currentToolTitle,
        terminalMessage: state.terminalMessage,
        updatedAt: state.updatedAt,
      }));

    this.onSubagentCallback(parentSessionId, subagents);
  }

  private createSubagentState(parentSessionId: string, sessionId: string | null): SubagentState {
    const cardId = `subagent-${parentSessionId}-${Date.now()}-${this.subagentStates.size}`;
    const state: SubagentState = {
      cardId,
      sessionId,
      parentSessionId,
      agent: "",
      description: "",
      prompt: "",
      status: "pending",
      providerID: undefined,
      modelID: undefined,
      currentTool: undefined,
      currentToolInput: undefined,
      currentToolTitle: undefined,
      terminalMessage: undefined,
      updatedAt: Date.now(),
      hasSubtaskMetadata: false,
      hasTaskToolMetadata: false,
      hasSessionTitleMetadata: false,
      createdAt: Date.now(),
    };

    this.subagentStates.set(cardId, state);
    this.getQueue(this.subagentOrderByParent, parentSessionId).push(cardId);
    if (sessionId) {
      this.subagentCardIdBySessionId.set(sessionId, cardId);
    }
    return state;
  }

  private enrichSubagentFromSubtask(
    state: SubagentState,
    details: { agent: string; description: string; prompt: string; command?: string },
  ): void {
    state.agent = details.agent || state.agent;
    state.description = details.description || details.prompt || state.description;
    state.prompt = details.prompt;
    state.command = details.command;
    state.hasSubtaskMetadata = true;
    state.updatedAt = Date.now();
  }

  private enrichSubagentFromTaskTool(
    state: SubagentState,
    details: { agent?: string; description?: string; prompt?: string; command?: string },
  ): void {
    const nextDescription = details.description?.trim() || details.prompt?.trim();
    if (details.agent?.trim()) {
      state.agent = details.agent.trim();
    }
    if (nextDescription) {
      state.description = nextDescription;
    }
    if (details.prompt?.trim()) {
      state.prompt = details.prompt.trim();
    }
    if (details.command?.trim()) {
      state.command = details.command.trim();
    }
    state.hasTaskToolMetadata = true;
    state.updatedAt = Date.now();
  }

  private enrichSubagentFromSessionTitle(state: SubagentState, title?: string): void {
    const trimmedTitle = title?.trim();
    if (!trimmedTitle) {
      return;
    }

    const match = trimmedTitle.match(/^(.*?)(?:\s+\(@([^\s)]+)\s+subagent\))?$/i);
    const rawDescription = match?.[1]?.trim() || trimmedTitle;
    const rawAgent = match?.[2]?.trim();

    if (rawDescription) {
      state.description = rawDescription;
    }

    if (rawAgent) {
      state.agent = rawAgent.replace(/^@/, "");
    }

    state.hasSessionTitleMetadata = true;
    state.updatedAt = Date.now();
  }

  private attachSessionToSubagent(cardId: string, sessionId: string): void {
    const state = this.subagentStates.get(cardId);
    if (!state) {
      return;
    }

    state.sessionId = sessionId;
    state.updatedAt = Date.now();
    this.subagentCardIdBySessionId.set(sessionId, cardId);
    this.removeFromQueue(this.pendingSubagentCardIdsByParent, state.parentSessionId, cardId);
  }

  private findNextSubagentForTaskTool(parentSessionId: string): SubagentState | null {
    const cardIds = this.subagentOrderByParent.get(parentSessionId) ?? [];
    for (const cardId of cardIds) {
      const state = this.subagentStates.get(cardId);
      if (state && !state.hasTaskToolMetadata) {
        return state;
      }
    }

    return null;
  }

  private updateSubagentFromTaskTool(
    parentSessionId: string,
    input?: { [key: string]: unknown },
  ): void {
    const subagent = this.findNextSubagentForTaskTool(parentSessionId);
    if (!subagent || !input) {
      return;
    }

    const description = typeof input.description === "string" ? input.description : undefined;
    const prompt = typeof input.prompt === "string" ? input.prompt : undefined;
    const agent = typeof input.subagent_type === "string" ? input.subagent_type : undefined;
    const command = typeof input.command === "string" ? input.command : undefined;

    if (!description && !prompt && !agent && !command) {
      return;
    }

    this.enrichSubagentFromTaskTool(subagent, { agent, description, prompt, command });
    this.emitSubagentState(parentSessionId);
  }

  private getOrCreateSubagentForSession(sessionId: string): SubagentState {
    const existingCardId = this.subagentCardIdBySessionId.get(sessionId);
    if (existingCardId) {
      return this.subagentStates.get(existingCardId)!;
    }

    const parentSessionId = this.getParentSessionId(sessionId) ?? sessionId;
    this.removeFromQueue(this.pendingChildSessionIdsByParent, parentSessionId, sessionId);
    const state = this.createSubagentState(parentSessionId, sessionId);
    this.getQueue(this.fallbackSubagentCardIdsByParent, parentSessionId).push(state.cardId);
    return state;
  }

  private registerSubtaskPart(
    parentSessionId: string,
    partId: string,
    agent: string,
    description: string,
    prompt: string,
    command?: string,
  ): void {
    const fallbackCardId = this.dequeue(this.fallbackSubagentCardIdsByParent, parentSessionId);
    if (fallbackCardId) {
      const fallbackState = this.subagentStates.get(fallbackCardId);
      if (fallbackState) {
        this.enrichSubagentFromSubtask(fallbackState, { agent, description, prompt, command });
        this.emitSubagentState(parentSessionId);
        return;
      }
    }

    const state = this.createSubagentState(parentSessionId, null);
    this.enrichSubagentFromSubtask(state, { agent, description, prompt, command });

    const pendingChildSessionId = this.dequeue(
      this.pendingChildSessionIdsByParent,
      parentSessionId,
    );
    if (pendingChildSessionId) {
      this.attachSessionToSubagent(state.cardId, pendingChildSessionId);
    } else {
      this.getQueue(this.pendingSubagentCardIdsByParent, parentSessionId).push(state.cardId);
    }

    this.emitSubagentState(parentSessionId);
  }

  private trackChildSession(sessionId: string, parentSessionId: string): void {
    this.trackedSessionParents.set(sessionId, parentSessionId);

    const pendingCardId = this.dequeue(this.pendingSubagentCardIdsByParent, parentSessionId);
    if (pendingCardId) {
      this.attachSessionToSubagent(pendingCardId, sessionId);
      this.emitSubagentState(parentSessionId);
      return;
    }

    this.getQueue(this.pendingChildSessionIdsByParent, parentSessionId).push(sessionId);
  }

  private handleSessionCreatedOrUpdated(
    event: Event & {
      type: "session.created" | "session.updated";
    },
  ): void {
    const info = (event.properties as { info?: { id?: string; parentID?: string; title?: string } })
      .info;
    if (!info?.id || !info.parentID || !this.trackedSessionIds.has(info.parentID)) {
      return;
    }

    if (!this.trackedSessionParents.has(info.id)) {
      this.trackChildSession(info.id, info.parentID);
    }

    const subagent = this.getOrCreateSubagentForSession(info.id);
    this.enrichSubagentFromSessionTitle(subagent, info.title);
    this.emitSubagentState(info.parentID);
  }

  private updateSubagentFromAssistantMessage(info: {
    sessionID: string;
    providerID?: string;
    modelID?: string;
    agent?: string;
  }): void {
    const subagent = this.getOrCreateSubagentForSession(info.sessionID);
    if (info.agent) {
      subagent.agent = info.agent;
    }
    if (info.providerID) {
      subagent.providerID = info.providerID;
    }
    if (info.modelID) {
      subagent.modelID = info.modelID;
    }
    subagent.status = "running";
    subagent.terminalMessage = undefined;
    subagent.updatedAt = Date.now();
    this.emitSubagentState(subagent.parentSessionId);
  }

  private updateSubagentToolState(
    sessionId: string,
    state: ToolState,
    tool: string,
    input?: { [key: string]: unknown },
    title?: string,
  ): void {
    const subagent = this.getOrCreateSubagentForSession(sessionId);
    const status = "status" in state ? state.status : undefined;

    if (status === "running" || status === "pending") {
      subagent.status = "running";
      subagent.terminalMessage = undefined;
    }

    subagent.currentTool = tool;
    subagent.currentToolInput = input ? { ...input } : undefined;
    subagent.currentToolTitle = title;
    subagent.updatedAt = Date.now();
    this.emitSubagentState(subagent.parentSessionId);
  }

  private updateSubagentStepStart(sessionId: string, snapshot?: string): void {
    const subagent = this.getOrCreateSubagentForSession(sessionId);
    subagent.status = "running";
    subagent.terminalMessage = undefined;
    subagent.currentTool = undefined;
    subagent.currentToolInput = undefined;
    subagent.currentToolTitle = snapshot?.trim() || subagent.currentToolTitle;
    subagent.updatedAt = Date.now();
    this.emitSubagentState(subagent.parentSessionId);
  }

  private updateSubagentStepFinish(sessionId: string, snapshot?: string): void {
    const subagent = this.getOrCreateSubagentForSession(sessionId);
    subagent.status = "running";
    subagent.terminalMessage = undefined;
    if (snapshot?.trim()) {
      subagent.currentToolTitle = snapshot.trim();
    }
    subagent.updatedAt = Date.now();
    this.emitSubagentState(subagent.parentSessionId);
  }

  private setSubagentTerminalStatus(
    sessionId: string,
    status: Extract<SubagentStatus, "completed" | "error">,
    terminalMessage?: string,
  ): void {
    const cardId = this.subagentCardIdBySessionId.get(sessionId);
    if (!cardId) {
      return;
    }

    const subagent = this.subagentStates.get(cardId);
    if (!subagent) {
      return;
    }

    subagent.status = status;
    subagent.currentTool = undefined;
    subagent.currentToolInput = undefined;
    subagent.currentToolTitle = undefined;
    subagent.terminalMessage = terminalMessage?.trim() || undefined;
    subagent.updatedAt = Date.now();
    this.emitSubagentState(subagent.parentSessionId);
  }

  private handleMessageUpdated(
    event: Event & {
      type: "message.updated";
    },
  ): void {
    const { info } = event.properties;

    if (this.isTrackedChildSession(info.sessionID)) {
      if (info.role === "assistant") {
        this.updateSubagentFromAssistantMessage(
          info as {
            sessionID: string;
            providerID?: string;
            modelID?: string;
            agent?: string;
          },
        );
      }
      return;
    }

    if (!this.isTrackedSession(info.sessionID)) {
      return;
    }

    const messageID = info.id;
    const messageKey = this.getMessageKey(info.sessionID, messageID);

    this.messages.set(messageKey, { role: info.role, sessionId: info.sessionID });

    if (info.role === "assistant") {
      if (!this.currentMessageParts.has(messageKey)) {
        this.currentMessageParts.set(messageKey, []);
        this.messageCount++;
        this.startTypingIndicator(info.sessionID);
      }

      const pending = this.pendingParts.get(messageKey) || [];
      const current = this.currentMessageParts.get(messageKey) || [];
      this.currentMessageParts.set(messageKey, [...current, ...pending]);
      this.pendingParts.delete(messageKey);
      this.emitMessageUpdated(messageKey, info.sessionID);

      const assistantMessage = info as { time?: { created: number; completed?: number } };
      const time = assistantMessage.time;

      if (time?.completed) {
        // Extract and report tokens BEFORE onComplete so keyboard context is updated
        const assistantInfo = info as {
          cost?: number;
          tokens?: {
            input: number;
            output: number;
            reasoning: number;
            cache: { read: number; write: number };
          };
        };

        const messageCost =
          typeof assistantInfo.cost === "number"
            ? assistantInfo.cost
            : this.stepFinishCosts.get(messageKey) || 0;

        if (this.onTokensCallback && (assistantInfo.tokens || messageCost > 0)) {
          const tokens: TokensInfo = {
            input: assistantInfo.tokens?.input || 0,
            output: assistantInfo.tokens?.output || 0,
            reasoning: assistantInfo.tokens?.reasoning || 0,
            cacheRead: assistantInfo.tokens?.cache?.read || 0,
            cacheWrite: assistantInfo.tokens?.cache?.write || 0,
            cost: messageCost,
          };
          logger.debug(
            `[Aggregator] Tokens: input=${tokens.input}, output=${tokens.output}, reasoning=${tokens.reasoning}, cost=${tokens.cost}`,
          );
          // Call synchronously so keyboardManager is updated before onComplete sends the reply
          this.onTokensCallback(info.sessionID, tokens);
        }

        this.scheduleMessageCompletion(messageKey, info.sessionID);
      }

      this.lastUpdated = Date.now();
    }
  }

  private handleMessagePartUpdated(
    event: Event & {
      type: "message.part.updated";
    },
  ): void {
    const { part } = event.properties;

    const isCurrentRootSession = this.isTrackedSession(part.sessionID);
    const isTrackedChildSession = this.isTrackedChildSession(part.sessionID);

    if (!isCurrentRootSession && !isTrackedChildSession) {
      return;
    }

    if (part.type === "subtask") {
      this.registerSubtaskPart(
        part.sessionID,
        part.id,
        (part as { agent?: string }).agent || "",
        (part as { description?: string }).description || "",
        (part as { prompt?: string }).prompt || "",
        (part as { command?: string }).command,
      );
      this.lastUpdated = Date.now();
      return;
    }

    if (isTrackedChildSession) {
      if (part.type === "tool") {
        const state = part.state;
        const input = "input" in state ? (state.input as { [key: string]: unknown }) : undefined;
        const title = "title" in state ? state.title : undefined;
        this.updateSubagentToolState(part.sessionID, state, part.tool, input, title);
      } else if (part.type === "step-start") {
        this.updateSubagentStepStart(part.sessionID, (part as { snapshot?: string }).snapshot);
      } else if (part.type === "step-finish") {
        this.updateSubagentStepFinish(part.sessionID, (part as { snapshot?: string }).snapshot);
      }

      this.lastUpdated = Date.now();
      return;
    }

    const messageID = part.messageID;
    const messageKey = this.getMessageKey(part.sessionID, messageID);
    const messageInfo = this.messages.get(messageKey);

    if (part.type === "reasoning") {
      // Fire the thinking callback once per message on the first reasoning part.
      // This is the signal that the model is actually doing extended thinking.
      if (!this.thinkingFiredForMessages.has(messageKey) && this.onThinkingCallback) {
        this.thinkingFiredForMessages.add(messageKey);
        const callback = this.onThinkingCallback;
        const sessionID = part.sessionID;
        setImmediate(() => {
          if (typeof callback === "function") {
            callback(sessionID);
          }
        });
      }
    } else if (part.type === "text" && "text" in part && part.text) {
      const partHash = this.hashString(part.text);

      if (!this.partHashes.has(messageKey)) {
        this.partHashes.set(messageKey, new Set());
      }

      const hashes = this.partHashes.get(messageKey)!;

      if (hashes.has(partHash)) {
        return;
      }

      hashes.add(partHash);

      if (messageInfo && messageInfo.role === "assistant") {
        if (!this.currentMessageParts.has(messageKey)) {
          this.currentMessageParts.set(messageKey, []);
          this.startTypingIndicator(part.sessionID);
        }

        const parts = this.currentMessageParts.get(messageKey)!;
        parts.push(part.text);
        this.emitMessageUpdated(messageKey, part.sessionID);

        if (this.completionTimers.has(messageKey)) {
          this.scheduleMessageCompletion(messageKey, part.sessionID);
        }
      } else {
        if (!this.pendingParts.has(messageKey)) {
          this.pendingParts.set(messageKey, []);
        }

        const pending = this.pendingParts.get(messageKey)!;
        pending.push(part.text);
      }
    } else if (part.type === "tool") {
      const state = part.state;
      const toolMetadata = (state as { metadata?: { [key: string]: unknown } }).metadata;
      const input = "input" in state ? (state.input as { [key: string]: unknown }) : undefined;
      const title = "title" in state ? state.title : undefined;

      logger.debug(
        `[Aggregator] Tool event: callID=${part.callID}, tool=${part.tool}, status=${"status" in state ? state.status : "unknown"}`,
      );

      if (part.tool === "task") {
        this.updateSubagentFromTaskTool(part.sessionID, input);
      }

      if (part.tool === "question") {
        logger.debug(`[Aggregator] Question tool part update:`, JSON.stringify(part, null, 2));

        // If the question tool fails, clear the active poll
        // so the agent can recreate it with corrected data
        if ("status" in state && state.status === "error") {
          logger.info(
            `[Aggregator] Question tool failed with error, clearing active poll. callID=${part.callID}`,
          );
          if (this.onQuestionErrorCallback) {
            setImmediate(() => {
              this.onQuestionErrorCallback!();
            });
          }
          return;
        }

        // NOTE: Questions are now handled via "question.asked" event, not via tool part updates.
        // This ensures we have access to the requestID needed for question.reply().
      }

      const status = "status" in state ? state.status : undefined;
      const shouldEmitToolUpdate =
        status === "running" || status === "completed" || status === "error";

      if (shouldEmitToolUpdate) {
        const processedStateKey = `${part.callID}:${status}`;

        if (!this.processedToolStates.has(processedStateKey)) {
          this.processedToolStates.add(processedStateKey);

          const toolData: ToolInfo = {
            sessionId: part.sessionID,
            messageId: messageID,
            callId: part.callID,
            tool: part.tool,
            state: part.state,
            input,
            title,
            metadata: toolMetadata,
            hasFileAttachment: false,
          };

          if (this.onToolCallback) {
            this.onToolCallback(toolData);
          }
        }
      }

      if (status === "completed") {
        logger.debug(
          `[Aggregator] Tool completed: callID=${part.callID}, tool=${part.tool}`,
          JSON.stringify(state, null, 2),
        );

        const completedKey = `completed-file-${part.callID}`;

        if (!this.processedToolStates.has(completedKey)) {
          this.processedToolStates.add(completedKey);

          const preparedFileContext = this.prepareToolFileContext(
            part.tool,
            input,
            title,
            toolMetadata,
          );

          const toolData: ToolInfo = {
            sessionId: part.sessionID,
            messageId: messageID,
            callId: part.callID,
            tool: part.tool,
            state: part.state,
            input,
            title,
            metadata: toolMetadata,
            hasFileAttachment: !!preparedFileContext.fileData,
          };

          if (preparedFileContext.fileData && this.onToolFileCallback) {
            logger.debug(
              `[Aggregator] Sending ${part.tool} file: ${preparedFileContext.fileData.filename} (${preparedFileContext.fileData.buffer.length} bytes)`,
            );
            this.onToolFileCallback({
              ...toolData,
              hasFileAttachment: true,
              fileData: preparedFileContext.fileData,
            });
          }

          if (preparedFileContext.fileChange && this.onFileChangeCallback) {
            this.onFileChangeCallback(preparedFileContext.fileChange, toolData.sessionId);
          }
        }
      }
    } else if (part.type === "step-finish" && typeof part.cost === "number") {
      const currentCost = this.stepFinishCosts.get(messageKey) || 0;
      this.stepFinishCosts.set(messageKey, currentCost + part.cost);
    }

    this.lastUpdated = Date.now();
  }

  private prepareToolFileContext(
    tool: string,
    input: { [key: string]: unknown } | undefined,
    title: string | undefined,
    metadata: { [key: string]: unknown } | undefined,
  ): PreparedToolFileContext {
    if (tool === "write" && input) {
      const filePath =
        typeof input.filePath === "string" ? normalizePathForDisplay(input.filePath) : "";
      const hasContent = typeof input.content === "string";
      const content = hasContent ? (input.content as string) : "";

      if (!filePath || !hasContent) {
        return { fileData: null, fileChange: null };
      }

      return {
        fileData: prepareCodeFile(content, filePath, "write"),
        fileChange: {
          file: filePath,
          additions: content.split("\n").length,
          deletions: 0,
        },
      };
    }

    if (tool === "edit" && metadata) {
      const editMetadata = metadata as {
        diff?: unknown;
        filediff?: { file?: string; additions?: number; deletions?: number };
      };
      const filePath = editMetadata.filediff?.file
        ? normalizePathForDisplay(editMetadata.filediff.file)
        : "";
      const diffText = typeof editMetadata.diff === "string" ? editMetadata.diff : "";

      if (!filePath || !diffText) {
        return { fileData: null, fileChange: null };
      }

      return {
        fileData: prepareCodeFile(diffText, filePath, "edit"),
        fileChange: {
          file: filePath,
          additions: editMetadata.filediff?.additions || 0,
          deletions: editMetadata.filediff?.deletions || 0,
        },
      };
    }

    if (tool === "apply_patch") {
      const patchMetadata = metadata as
        | {
            filediff?: { file?: string; additions?: number; deletions?: number };
            diff?: string;
          }
        | undefined;

      const filePathFromInput =
        input && typeof input.filePath === "string"
          ? normalizePathForDisplay(input.filePath)
          : input && typeof input.path === "string"
            ? normalizePathForDisplay(input.path)
            : "";
      const filePathFromTitle = title ? extractFirstUpdatedFileFromTitle(title) : "";

      const filePath =
        (patchMetadata?.filediff?.file && normalizePathForDisplay(patchMetadata.filediff.file)) ||
        filePathFromInput ||
        normalizePathForDisplay(filePathFromTitle);
      const diffText =
        typeof patchMetadata?.diff === "string"
          ? patchMetadata.diff
          : input && typeof input.patchText === "string"
            ? input.patchText
            : "";

      if (!filePath) {
        return { fileData: null, fileChange: null };
      }

      const fileChange = patchMetadata?.filediff
        ? {
            file: filePath,
            additions: patchMetadata.filediff.additions || 0,
            deletions: patchMetadata.filediff.deletions || 0,
          }
        : diffText
          ? (() => {
              const changes = countDiffChangesFromText(diffText);
              return {
                file: filePath,
                additions: changes.additions,
                deletions: changes.deletions,
              };
            })()
          : null;

      return {
        fileData: diffText ? prepareCodeFile(diffText, filePath, "edit") : null,
        fileChange,
      };
    }

    return { fileData: null, fileChange: null };
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  private handleSessionStatus(
    event: Event & {
      type: "session.status";
    },
  ): void {
    const { sessionID, status } = event.properties as {
      sessionID: string;
      status?: {
        type?: string;
        attempt?: number;
        message?: string;
        next?: number;
      };
    };

    if (!this.isTrackedSession(sessionID)) {
      return;
    }

    if (status?.type !== "retry" || !this.onSessionRetryCallback) {
      return;
    }

    const callback = this.onSessionRetryCallback;
    const message = status.message?.trim() || "Unknown retry error";

    logger.warn(
      `[Aggregator] Session retry: session=${sessionID}, attempt=${status.attempt ?? "n/a"}, message=${message}`,
    );

    setImmediate(() => {
      callback({
        sessionId: sessionID,
        attempt: status.attempt,
        message,
        next: status.next,
      });
    });
  }

  private handleSessionIdle(
    event: Event & {
      type: "session.idle";
    },
  ): void {
    const { sessionID } = event.properties;

    if (this.isTrackedChildSession(sessionID)) {
      logger.info(`[Aggregator] Subagent session became idle: ${sessionID}`);
      this.setSubagentTerminalStatus(sessionID, "completed");
      return;
    }

    if (!this.isTrackedSession(sessionID)) {
      return;
    }

    logger.info(`[Aggregator] Session became idle: ${sessionID}`);

    this.flushPendingCompletionsForSession(sessionID);

    // Stop typing indicator when session goes idle
    this.stopTypingIndicator(sessionID);

    if (this.onSessionIdleCallback) {
      const callback = this.onSessionIdleCallback;
      setImmediate(() => {
        callback(sessionID);
      });
    }
  }

  private handleSessionCompacted(
    event: Event & {
      type: "session.compacted";
    },
  ): void {
    const properties = event.properties as { sessionID: string };
    const { sessionID } = properties;

    if (!this.isTrackedSession(sessionID)) {
      return;
    }

    logger.info(`[Aggregator] Session compacted: ${sessionID}`);

    // Reload context from history after compaction
    if (this.onSessionCompactedCallback) {
      setImmediate(() => {
        const session = getSessionById(sessionID);
        if (session?.directory) {
          this.onSessionCompactedCallback!(sessionID, session.directory);
        }
      });
    }
  }

  private handleSessionError(
    event: Event & {
      type: "session.error";
    },
  ): void {
    const { sessionID, error } = event.properties as {
      sessionID: string;
      error?: {
        name?: string;
        message?: string;
        data?: { message?: string };
      };
    };

    const message =
      error?.data?.message || error?.message || error?.name || "Unknown session error";

    if (this.isTrackedChildSession(sessionID)) {
      logger.warn(`[Aggregator] Subagent session error: ${sessionID}: ${message}`);
      this.setSubagentTerminalStatus(sessionID, "error", message);
      return;
    }

    if (!this.isTrackedSession(sessionID)) {
      return;
    }

    logger.warn(`[Aggregator] Session error: ${sessionID}: ${message}`);
    this.flushPendingCompletionsForSession(sessionID);
    this.stopTypingIndicator(sessionID);

    if (this.onSessionErrorCallback) {
      const callback = this.onSessionErrorCallback;
      setImmediate(() => {
        callback(sessionID, message);
      });
    }
  }

  private handleQuestionAsked(
    event: Event & {
      type: "question.asked";
    },
  ): void {
    const { id, sessionID, questions } = event.properties;

    if (!this.isTrackedSession(sessionID)) {
      logger.debug(`[Aggregator] Ignoring question.asked for untracked session: ${sessionID}`);
      return;
    }

    logger.info(`[Aggregator] Question asked: requestID=${id}, questions=${questions.length}`);

    if (this.onQuestionCallback) {
      const callback = this.onQuestionCallback;
      setImmediate(async () => {
        try {
          await callback(sessionID, questions as Question[], id);
        } catch (err) {
          logger.error("[Aggregator] Error in question callback:", err);
        }
      });
    }
  }

  private handleSessionDiff(event: Event): void {
    const properties = event.properties as {
      sessionID: string;
      diff: Array<{ file: string; additions: number; deletions: number }>;
    };

    if (!this.isTrackedSession(properties.sessionID)) {
      return;
    }

    logger.debug(`[Aggregator] Session diff: ${properties.diff.length} files changed`);

    if (this.onSessionDiffCallback) {
      const diffs: FileChange[] = properties.diff.map((d) => ({
        file: d.file,
        additions: d.additions,
        deletions: d.deletions,
      }));

      const callback = this.onSessionDiffCallback;
      setImmediate(() => {
        callback(properties.sessionID, diffs);
      });
    }
  }

  private handlePermissionAsked(
    event: Event & {
      type: "permission.asked";
    },
  ): void {
    const request = event.properties;

    if (!this.isTrackedSession(request.sessionID)) {
      logger.debug(
        `[Aggregator] Ignoring permission.asked for untracked session: ${request.sessionID}`,
      );
      return;
    }

    logger.info(
      `[Aggregator] Permission asked: requestID=${request.id}, type=${request.permission}, patterns=${request.patterns.length}`,
    );

    if (this.onPermissionCallback) {
      const callback = this.onPermissionCallback;
      setImmediate(async () => {
        try {
          await callback(request as PermissionRequest);
        } catch (err) {
          logger.error("[Aggregator] Error in permission callback:", err);
        }
      });
    }
  }

  private clearCompletionTimer(messageKey: string): void {
    const timer = this.completionTimers.get(messageKey);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.completionTimers.delete(messageKey);
  }

  private emitMessageUpdated(messageKey: string, sessionId: string): void {
    if (!this.onMessageUpdatedCallback) {
      return;
    }

    const parts = this.currentMessageParts.get(messageKey) || [];
    const messageText = parts.join("");
    if (!messageText) {
      return;
    }

    if (this.lastStreamedMessageText.get(messageKey) === messageText) {
      return;
    }

    this.lastStreamedMessageText.set(messageKey, messageText);
    this.onMessageUpdatedCallback(sessionId, messageText);
  }

  private scheduleMessageCompletion(messageKey: string, sessionId: string): void {
    this.clearCompletionTimer(messageKey);

    const timer = setTimeout(() => {
      this.completionTimers.delete(messageKey);
      this.finalizeMessageCompletion(messageKey, sessionId);
    }, SummaryAggregator.COMPLETION_DEBOUNCE_MS);

    this.completionTimers.set(messageKey, timer);
  }

  private flushPendingCompletionsForSession(sessionId: string): void {
    for (const [messageKey, message] of this.messages.entries()) {
      if (message.sessionId !== sessionId || !this.completionTimers.has(messageKey)) {
        continue;
      }

      this.clearCompletionTimer(messageKey);
      this.finalizeMessageCompletion(messageKey, sessionId);
    }
  }

  private finalizeMessageCompletion(messageKey: string, sessionId: string): void {
    const parts = this.currentMessageParts.get(messageKey) || [];
    const messageText = parts.join("");

    logger.debug(
      `[Aggregator] Message completed: messageKey=${messageKey}, textLength=${messageText.length}, totalParts=${parts.length}, session=${sessionId}`,
    );

    if (this.onCompleteCallback && messageText.length > 0) {
      this.onCompleteCallback(sessionId, messageText);
    }

    this.currentMessageParts.delete(messageKey);
    this.messages.delete(messageKey);
    this.pendingParts.delete(messageKey);
    this.partHashes.delete(messageKey);
    this.stepFinishCosts.delete(messageKey);
    this.lastStreamedMessageText.delete(messageKey);
    this.thinkingFiredForMessages.delete(messageKey);

    logger.debug(
      `[Aggregator] Message completed cleanup: remaining messages=${this.currentMessageParts.size}`,
    );

    if (!this.hasActiveMessageForSession(sessionId)) {
      logger.debug(
        `[Aggregator] No more active messages for session ${sessionId}, stopping typing indicator`,
      );
      this.stopTypingIndicator(sessionId);
    }
  }
}

export const summaryAggregator = new SummaryAggregator();
