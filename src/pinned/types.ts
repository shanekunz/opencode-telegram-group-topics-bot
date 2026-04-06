/**
 * Token information from AssistantMessage
 */
export interface TokensInfo {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

/**
 * File change info from OpenCode session diff
 */
export interface FileChange {
  file: string;
  additions: number;
  deletions: number;
}

/**
 * State of the pinned status message
 */
export interface PinnedMessageState {
  scopeKey?: string;
  messageId: number | null;
  chatId: number | null;
  threadId?: number | null;
  sessionId: string | null;
  sessionTitle: string;
  projectName: string;
  projectBranch: string | null;
  tokensUsed: number;
  tokensLimit: number;
  assistantCost: number;
  lastUpdated: number;
  changedFiles: FileChange[];
}
