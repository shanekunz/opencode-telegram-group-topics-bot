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
    const queue = this.completions.get(sessionId) ?? [];
    this.completions.delete(sessionId);
    return [...queue];
  }

  clear(sessionId: string): void {
    this.completions.delete(sessionId);
  }
}

export const pendingAssistantCompletions = new PendingAssistantCompletions();
