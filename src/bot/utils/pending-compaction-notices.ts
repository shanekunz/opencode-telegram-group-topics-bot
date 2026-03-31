const pendingCompactionNotices = new Set<string>();

export function markPendingCompactionNotice(sessionId: string): void {
  pendingCompactionNotices.add(sessionId);
}

export function consumePendingCompactionNotice(sessionId: string): boolean {
  if (!pendingCompactionNotices.has(sessionId)) {
    return false;
  }

  pendingCompactionNotices.delete(sessionId);
  return true;
}

export function clearPendingCompactionNotice(sessionId: string): void {
  pendingCompactionNotices.delete(sessionId);
}
