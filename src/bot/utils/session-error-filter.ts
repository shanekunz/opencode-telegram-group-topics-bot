const OPERATION_ABORTED_MARKERS = [
  "the operation was aborted",
  "operation was aborted",
  "aborterror",
];

export function isOperationAbortedSessionError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return OPERATION_ABORTED_MARKERS.some((marker) => normalized.includes(marker));
}

export class SessionErrorThrottle {
  private readonly lastBySession = new Map<string, { message: string; timestamp: number }>();

  constructor(private readonly windowMs: number = 3000) {}

  shouldSuppress(sessionId: string, message: string, now: number = Date.now()): boolean {
    const normalized = message.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    const previous = this.lastBySession.get(sessionId);
    this.lastBySession.set(sessionId, {
      message: normalized,
      timestamp: now,
    });

    if (!previous) {
      return false;
    }

    return previous.message === normalized && now - previous.timestamp < this.windowMs;
  }
}
