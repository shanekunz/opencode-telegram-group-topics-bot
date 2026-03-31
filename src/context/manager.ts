import type { ContextInfo } from "../keyboard/types.js";

class ContextStateManager {
  private readonly contextByScope = new Map<string, ContextInfo>();

  update(tokensUsed: number, tokensLimit: number, scopeKey: string = "global"): void {
    this.contextByScope.set(scopeKey, { tokensUsed, tokensLimit });
  }

  clear(scopeKey: string = "global"): void {
    this.contextByScope.delete(scopeKey);
  }

  get(scopeKey: string = "global"): ContextInfo | null {
    return this.contextByScope.get(scopeKey) ?? null;
  }
}

export const contextStateManager = new ContextStateManager();
