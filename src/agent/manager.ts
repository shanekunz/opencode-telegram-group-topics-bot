import { opencodeClient } from "../opencode/client.js";
import { getCurrentProject, getCurrentAgent, setCurrentAgent } from "../settings/manager.js";
import { getCurrentSession } from "../session/manager.js";
import { logger } from "../utils/logger.js";
import type { AgentInfo } from "./types.js";

const DEFAULT_AGENT = "build";

function pickFallbackAgent(agents: AgentInfo[]): string {
  const defaultAgent = agents.find((agent) => agent.name === DEFAULT_AGENT);
  if (defaultAgent) {
    return defaultAgent.name;
  }

  return agents[0]?.name ?? DEFAULT_AGENT;
}

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

  if (!project) {
    return storedAgent ?? DEFAULT_AGENT;
  }

  if (!session) {
    return resolveProjectAgent(storedAgent ?? DEFAULT_AGENT, scopeKey);
  }

  try {
    const { data: messages, error } = await opencodeClient.session.messages({
      sessionID: session.id,
      directory: project.worktree,
      limit: 1,
    });

    if (error || !messages || messages.length === 0) {
      return resolveProjectAgent(storedAgent ?? DEFAULT_AGENT, scopeKey);
    }

    const lastAgent = messages[0].info.agent;
    if (storedAgent && lastAgent !== storedAgent) {
      return resolveProjectAgent(storedAgent, scopeKey);
    }

    if (lastAgent && lastAgent !== storedAgent) {
      setCurrentAgent(lastAgent, scopeKey);
    }

    return resolveProjectAgent(lastAgent || storedAgent || DEFAULT_AGENT, scopeKey);
  } catch (err) {
    logger.error("[AgentManager] Error fetching current agent:", err);
    return resolveProjectAgent(storedAgent ?? DEFAULT_AGENT, scopeKey);
  }
}

export async function resolveProjectAgent(
  preferredAgent?: string,
  scopeKey: string = "global",
): Promise<string> {
  const requestedAgent = preferredAgent ?? getCurrentAgent(scopeKey) ?? DEFAULT_AGENT;
  const project = getCurrentProject(scopeKey);

  if (!project) {
    return requestedAgent;
  }

  const agents = await getAvailableAgents(scopeKey);
  if (agents.length === 0) {
    return requestedAgent;
  }

  if (agents.some((agent) => agent.name === requestedAgent)) {
    return requestedAgent;
  }

  const fallbackAgent = pickFallbackAgent(agents);
  logger.warn(
    `[AgentManager] Agent "${requestedAgent}" is not available for scope ${scopeKey}. Falling back to "${fallbackAgent}".`,
  );
  setCurrentAgent(fallbackAgent, scopeKey);
  return fallbackAgent;
}

export function selectAgent(agentName: string, scopeKey: string = "global"): void {
  logger.info(`[AgentManager] Selected agent: ${agentName}`);
  setCurrentAgent(agentName, scopeKey);
}

export function getStoredAgent(scopeKey: string = "global"): string {
  return getCurrentAgent(scopeKey) ?? DEFAULT_AGENT;
}
