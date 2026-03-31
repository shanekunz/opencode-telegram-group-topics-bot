import { t } from "../i18n/index.js";
import type { SubagentInfo, ToolInfo } from "./aggregator.js";
import { formatCompactToolInfo } from "./formatter.js";

function formatModelDisplayName(providerID?: string, modelID?: string): string {
  if (providerID && modelID) {
    return `${providerID}/${modelID}`;
  }

  return t("pinned.unknown");
}

function formatToolStep(subagent: SubagentInfo): string {
  if (!subagent.currentTool) {
    return "";
  }

  const toolInfo: ToolInfo = {
    sessionId: subagent.sessionId ?? subagent.parentSessionId,
    messageId: subagent.cardId,
    callId: subagent.cardId,
    tool: subagent.currentTool,
    state: {
      status: "running",
      input: subagent.currentToolInput ?? {},
      title: subagent.currentToolTitle,
      metadata: {},
      time: { start: subagent.updatedAt },
    },
    input: subagent.currentToolInput,
    title: subagent.currentToolTitle,
    metadata: {},
    hasFileAttachment: false,
  };

  const formatted = formatCompactToolInfo(toolInfo, 128, "").trim();
  const firstSpaceIndex = formatted.indexOf(" ");
  if (firstSpaceIndex >= 0 && formatted.slice(firstSpaceIndex + 1) === subagent.currentTool) {
    return "";
  }

  return formatted;
}

function formatSubagentActivity(subagent: SubagentInfo): string {
  if (subagent.status === "completed") {
    return `✅ ${t("subagent.completed")}`;
  }

  if (subagent.status === "error") {
    const message = subagent.terminalMessage?.trim() || t("subagent.failed");
    return `❌ ${message}`;
  }

  const toolStep = formatToolStep(subagent);
  if (toolStep) {
    return toolStep;
  }

  return `⚙️ ${t("subagent.working")}`;
}

function formatSubagentCard(subagent: SubagentInfo): string {
  const modelName = formatModelDisplayName(subagent.providerID, subagent.modelID);
  const lines = [
    `🧩 ${t("subagent.line.task", { task: subagent.description })}`,
    t("subagent.line.agent", { agent: subagent.agent || t("pinned.unknown") }),
    t("pinned.line.model", { model: modelName }),
    "",
    formatSubagentActivity(subagent),
  ];

  return lines.join("\n");
}

export function renderSubagentCards(subagents: SubagentInfo[]): string {
  if (subagents.length === 0) {
    return "";
  }

  return subagents.map((subagent) => formatSubagentCard(subagent)).join("\n\n");
}
