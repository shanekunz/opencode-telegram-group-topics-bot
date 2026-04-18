import { getAgentDisplayName } from "../../agent/types.js";
import type { AssistantRunInfo } from "../assistant-run-state.js";

function formatElapsedSeconds(elapsedMs: number): string {
  const safeElapsedMs = Math.max(0, elapsedMs);
  return `${(safeElapsedMs / 1000).toFixed(1)}s`;
}

export function formatAssistantRunFooter(run: AssistantRunInfo, finishedAt = Date.now()): string {
  const agent = run.configuredAgent ? getAgentDisplayName(run.configuredAgent) : "🤖 Assistant";
  const providerID = run.configuredProviderID ?? "unknown";
  const modelID = run.configuredModelID ?? "unknown";
  return `${agent} · 🤖 ${providerID}/${modelID} · 🕒 ${formatElapsedSeconds(finishedAt - run.startedAt)}`;
}
