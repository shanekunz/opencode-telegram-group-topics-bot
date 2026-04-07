export class PendingAssistantCompletions {
  private readonly completions = new Map<string, string[]>();

  enqueue(sessionId: string, messageText: string): void {
    const normalizedText = messageText.trim();
    if (!sessionId || normalizedText.length === 0) {
      return;
    }

    const queue = this.completions.get(sessionId) ?? [];
    queue.push(normalizedText);
    this.completions.set(sessionId, queue);
  }

  consume(sessionId: string): string[] {
    const queued = this.completions.get(sessionId) ?? [];
    this.completions.delete(sessionId);
    return [...queued];
  }

  prepend(sessionId: string, messageTexts: string[]): void {
    const normalizedTexts = messageTexts
      .map((text) => text.trim())
      .filter((text) => text.length > 0);
    if (!sessionId || normalizedTexts.length === 0) {
      return;
    }

    const existing = this.completions.get(sessionId) ?? [];
    this.completions.set(sessionId, [...normalizedTexts, ...existing]);
  }

  has(sessionId: string): boolean {
    const queue = this.completions.get(sessionId);
    return Array.isArray(queue) && queue.length > 0;
  }

  clear(sessionId: string): void {
    this.completions.delete(sessionId);
  }
}

export const pendingAssistantCompletions = new PendingAssistantCompletions();
