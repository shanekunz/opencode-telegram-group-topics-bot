export class PendingAssistantCompletions {
  private readonly completions = new Map<string, string[]>();

  enqueue(sessionId: string, messageText: string): void {
    const normalizedText = messageText.trim();
    if (!sessionId || normalizedText.length === 0) {
      return;
    }

    const existing = this.completions.get(sessionId) ?? [];
    existing.push(normalizedText);
    this.completions.set(sessionId, existing);
  }

  consume(sessionId: string): string[] {
    const pending = this.completions.get(sessionId);
    if (!pending || pending.length === 0) {
      return [];
    }

    this.completions.delete(sessionId);
    return [...pending];
  }

  clear(sessionId: string): void {
    this.completions.delete(sessionId);
  }
}

export const pendingAssistantCompletions = new PendingAssistantCompletions();
