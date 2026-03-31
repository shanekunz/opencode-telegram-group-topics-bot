export class PendingAssistantCompletions {
  private readonly completions = new Map<string, string>();

  enqueue(sessionId: string, messageText: string): void {
    const normalizedText = messageText.trim();
    if (!sessionId || normalizedText.length === 0) {
      return;
    }

    this.completions.set(sessionId, normalizedText);
  }

  peek(sessionId: string): string | null {
    return this.completions.get(sessionId) ?? null;
  }

  clear(sessionId: string): void {
    this.completions.delete(sessionId);
  }
}

export const pendingAssistantCompletions = new PendingAssistantCompletions();
