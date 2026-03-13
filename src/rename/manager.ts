import { logger } from "../utils/logger.js";

interface RenameState {
  isWaiting: boolean;
  sessionId: string | null;
  sessionDirectory: string | null;
  currentTitle: string | null;
  messageId: number | null;
}

class RenameManager {
  private stateByScope: Map<string, RenameState> = new Map();

  private getState(scopeKey: string): RenameState {
    const state = this.stateByScope.get(scopeKey);
    if (state) {
      return state;
    }

    const nextState: RenameState = {
      isWaiting: false,
      sessionId: null,
      sessionDirectory: null,
      currentTitle: null,
      messageId: null,
    };

    this.stateByScope.set(scopeKey, nextState);
    return nextState;
  }

  startWaiting(
    sessionId: string,
    directory: string,
    currentTitle: string,
    scopeKey: string = "global",
  ): void {
    logger.info(`[RenameManager] Starting rename flow for session: ${sessionId}`);
    this.stateByScope.set(scopeKey, {
      isWaiting: true,
      sessionId,
      sessionDirectory: directory,
      currentTitle,
      messageId: null,
    });
  }

  setMessageId(messageId: number, scopeKey: string = "global"): void {
    this.getState(scopeKey).messageId = messageId;
  }

  getMessageId(scopeKey: string = "global"): number | null {
    return this.getState(scopeKey).messageId;
  }

  isActiveMessage(messageId: number | null, scopeKey: string = "global"): boolean {
    const state = this.getState(scopeKey);
    return state.isWaiting && state.messageId !== null && state.messageId === messageId;
  }

  isWaitingForName(scopeKey: string = "global"): boolean {
    return this.getState(scopeKey).isWaiting;
  }

  getSessionInfo(
    scopeKey: string = "global",
  ): { sessionId: string; directory: string; currentTitle: string } | null {
    const state = this.getState(scopeKey);
    if (!state.isWaiting || !state.sessionId) {
      return null;
    }
    return {
      sessionId: state.sessionId,
      directory: state.sessionDirectory!,
      currentTitle: state.currentTitle!,
    };
  }

  clear(scopeKey: string = "global"): void {
    logger.debug("[RenameManager] Clearing rename state");
    this.stateByScope.set(scopeKey, {
      isWaiting: false,
      sessionId: null,
      sessionDirectory: null,
      currentTitle: null,
      messageId: null,
    });
  }
}

export const renameManager = new RenameManager();
