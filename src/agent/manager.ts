import { opencodeClient } from "../opencode/client.js";
import { getCurrentProject, getCurrentAgent, setCurrentAgent } from "../settings/manager.js";
import { getCurrentSession } from "../session/manager.js";
import { logger } from "../utils/logger.js";
import type { AgentInfo } from "./types.js";

const DEFAULT_AGENT = "build";

export async function getAvailableAgents(scopeKey: string = "global"): Promise<AgentInfo[]> {
  try {
    const project = getCurrentProject(scopeKey);
    const { data: agents, error } = await opencodeClient.app.agents(
      project ? { directory: project.worktree } : undefined,
    );

    if (error) {
      logger.error("[AgentManager] Failed to fetch agents:", error);
      return [];
    }

    if (!agents) {
      return [];
    }

    return agents.filter(
      (agent) => !agent.hidden && (agent.mode === "primary" || agent.mode === "all"),
    );
  } catch (err) {
    logger.error("[AgentManager] Error fetching agents:", err);
    return [];
  }
}

export async function fetchCurrentAgent(scopeKey: string = "global"): Promise<string> {
  const storedAgent = getCurrentAgent(scopeKey);
  const session = getCurrentSession(scopeKey);
  const project = getCurrentProject(scopeKey);

  if (!session || !project) {
    return storedAgent ?? DEFAULT_AGENT;
  }

  try {
    const { data: messages, error } = await opencodeClient.session.messages({
      sessionID: session.id,
      directory: project.worktree,
      limit: 1,
    });

    if (error || !messages || messages.length === 0) {
      return storedAgent ?? DEFAULT_AGENT;
    }

    const lastAgent = messages[0].info.agent;
    if (storedAgent && lastAgent !== storedAgent) {
      return storedAgent;
    }

    if (lastAgent && lastAgent !== storedAgent) {
      setCurrentAgent(lastAgent, scopeKey);
    }

    return lastAgent || storedAgent || DEFAULT_AGENT;
  } catch (err) {
    logger.error("[AgentManager] Error fetching current agent:", err);
    return storedAgent ?? DEFAULT_AGENT;
  }
}

export function selectAgent(agentName: string, scopeKey: string = "global"): void {
  logger.info(`[AgentManager] Selected agent: ${agentName}`);
  setCurrentAgent(agentName, scopeKey);
}

export function getStoredAgent(scopeKey: string = "global"): string {
  return getCurrentAgent(scopeKey) ?? DEFAULT_AGENT;
}
