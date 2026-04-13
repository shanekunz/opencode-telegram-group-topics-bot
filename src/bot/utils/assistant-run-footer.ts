import { getAgentDisplayName } from "../../agent/types.js";

interface AssistantRunFooterParams {
  agent: string;
  providerID: string;
  modelID: string;
  elapsedMs: number;
}

function formatElapsedSeconds(elapsedMs: number): string {
  const safeElapsedMs = Math.max(0, elapsedMs);
  return `${(safeElapsedMs / 1000).toFixed(1)}s`;
}

export function formatAssistantRunFooter({
  agent,
  providerID,
  modelID,
  elapsedMs,
}: AssistantRunFooterParams): string {
  const agentDisplay = getAgentDisplayName(agent);
  return `${agentDisplay} · 🤖 ${providerID}/${modelID} · 🕒 ${formatElapsedSeconds(elapsedMs)}`;
}
