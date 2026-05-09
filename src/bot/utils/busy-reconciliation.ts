import { opencodeClient } from "../../opencode/client.js";
import { assistantRunState } from "../assistant-run-state.js";
import { dispatchNextQueuedPrompt, clearPromptResponseMode } from "../handlers/prompt.js";
import { logger } from "../../utils/logger.js";

const RECONCILE_MIN_INTERVAL_MS = 10_000;

type SessionStatus = {
  type?: string;
};

const inFlightDirectories = new Set<string>();
const lastReconcileAtByDirectory = new Map<string, number>();

function getDirectoryRunSessionIds(directory: string): string[] {
  return assistantRunState
    .listRuns()
    .filter((run) => run.directory === directory)
    .map((run) => run.sessionId);
}

function getSessionStatus(statuses: unknown, sessionId: string): SessionStatus | null {
  if (!statuses || typeof statuses !== "object") {
    return null;
  }

  return (statuses as Record<string, SessionStatus | undefined>)[sessionId] ?? null;
}

function isTerminalStatus(status: SessionStatus | null): boolean {
  return !status || status.type === "idle" || status.type === "error";
}

export async function reconcileBusyStateNow(directory: string): Promise<void> {
  if (!directory) {
    return;
  }

  const sessionIds = getDirectoryRunSessionIds(directory);
  if (sessionIds.length === 0) {
    return;
  }

  const { data: statuses, error } = await opencodeClient.session.status({ directory });
  if (error || !statuses) {
    logger.warn("[BusyReconciliation] Failed to load session status", error);
    return;
  }

  for (const sessionId of sessionIds) {
    const status = getSessionStatus(statuses, sessionId);
    if (!isTerminalStatus(status)) {
      continue;
    }

    logger.info(
      `[BusyReconciliation] Clearing stale run state: session=${sessionId}, directory=${directory}, status=${status?.type ?? "not-found"}`,
    );
    clearPromptResponseMode(sessionId);
    assistantRunState.clearRun(sessionId, "status_reconcile_idle");
    await dispatchNextQueuedPrompt(sessionId);
  }
}

export async function reconcileBusyState(directory: string): Promise<void> {
  if (!directory || inFlightDirectories.has(directory)) {
    return;
  }

  if (getDirectoryRunSessionIds(directory).length === 0) {
    return;
  }

  const now = Date.now();
  const lastReconcileAt = lastReconcileAtByDirectory.get(directory);
  if (lastReconcileAt !== undefined && now - lastReconcileAt < RECONCILE_MIN_INTERVAL_MS) {
    return;
  }

  lastReconcileAtByDirectory.set(directory, now);
  inFlightDirectories.add(directory);

  try {
    await reconcileBusyStateNow(directory);
  } catch (error) {
    logger.warn("[BusyReconciliation] Failed to reconcile busy state", error);
  } finally {
    inFlightDirectories.delete(directory);
  }
}

export function __resetBusyReconciliationForTests(): void {
  inFlightDirectories.clear();
  lastReconcileAtByDirectory.clear();
}
