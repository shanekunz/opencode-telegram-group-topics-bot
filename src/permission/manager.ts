import { PermissionRequest, PermissionState } from "./types.js";
import { logger } from "../utils/logger.js";

class PermissionManager {
  private stateByScope: Map<string, PermissionState> = new Map();

  private getState(scopeKey: string): PermissionState {
    const state = this.stateByScope.get(scopeKey);
    if (state) {
      return state;
    }

    const next: PermissionState = {
      requestsByMessageId: new Map(),
    };
    this.stateByScope.set(scopeKey, next);
    return next;
  }

  startPermission(
    request: PermissionRequest,
    messageId: number,
    scopeKey: string = "global",
  ): void {
    const state = this.getState(scopeKey);

    logger.debug(
      `[PermissionManager] startPermission: id=${request.id}, permission=${request.permission}, messageId=${messageId}`,
    );

    if (state.requestsByMessageId.has(messageId)) {
      logger.warn(`[PermissionManager] Message ID already tracked, replacing: ${messageId}`);
    }

    state.requestsByMessageId.set(messageId, request);

    logger.info(
      `[PermissionManager] New permission request: type=${request.permission}, patterns=${request.patterns.join(", ")}, pending=${state.requestsByMessageId.size}`,
    );
  }

  getRequest(messageId: number | null, scopeKey: string = "global"): PermissionRequest | null {
    if (messageId === null) {
      return null;
    }

    return this.getState(scopeKey).requestsByMessageId.get(messageId) ?? null;
  }

  getRequestByID(
    requestID: string,
    scopeKey: string = "global",
  ): { messageId: number; request: PermissionRequest } | null {
    const entries = Array.from(this.getState(scopeKey).requestsByMessageId.entries());
    for (const [messageId, request] of entries) {
      if (request.id === requestID) {
        return { messageId, request };
      }
    }

    return null;
  }

  getRequestID(messageId: number | null, scopeKey: string = "global"): string | null {
    return this.getRequest(messageId, scopeKey)?.id ?? null;
  }

  getPermissionType(messageId: number | null, scopeKey: string = "global"): string | null {
    return this.getRequest(messageId, scopeKey)?.permission ?? null;
  }

  getPatterns(messageId: number | null, scopeKey: string = "global"): string[] {
    return this.getRequest(messageId, scopeKey)?.patterns ?? [];
  }

  isActiveMessage(messageId: number | null, scopeKey: string = "global"): boolean {
    return messageId !== null && this.getState(scopeKey).requestsByMessageId.has(messageId);
  }

  getMessageId(scopeKey: string = "global"): number | null {
    const messageIds = this.getMessageIds(scopeKey);
    if (messageIds.length === 0) {
      return null;
    }

    return messageIds[messageIds.length - 1];
  }

  getMessageIds(scopeKey: string = "global"): number[] {
    return Array.from(this.getState(scopeKey).requestsByMessageId.keys());
  }

  removeByMessageId(
    messageId: number | null,
    scopeKey: string = "global",
  ): PermissionRequest | null {
    const state = this.getState(scopeKey);
    const request = this.getRequest(messageId, scopeKey);
    if (!request || messageId === null) {
      return null;
    }

    state.requestsByMessageId.delete(messageId);

    logger.debug(
      `[PermissionManager] Removed permission request: id=${request.id}, messageId=${messageId}, pending=${state.requestsByMessageId.size}`,
    );

    return request;
  }

  removeByRequestID(requestID: string, scopeKey: string = "global"): PermissionRequest | null {
    const match = this.getRequestByID(requestID, scopeKey);
    if (!match) {
      return null;
    }

    return this.removeByMessageId(match.messageId, scopeKey);
  }

  getPendingCount(scopeKey: string = "global"): number {
    return this.getState(scopeKey).requestsByMessageId.size;
  }

  isActive(scopeKey: string = "global"): boolean {
    return this.getState(scopeKey).requestsByMessageId.size > 0;
  }

  clear(scopeKey: string = "global"): void {
    const state = this.getState(scopeKey);

    logger.debug(
      `[PermissionManager] Clearing permission state: pending=${state.requestsByMessageId.size}`,
    );

    this.stateByScope.set(scopeKey, {
      requestsByMessageId: new Map(),
    });
  }
}

export const permissionManager = new PermissionManager();
