import { beforeEach, describe, expect, it } from "vitest";
import { assistantRunState } from "../../src/bot/assistant-run-state.js";

describe("bot/assistant-run-state", () => {
  beforeEach(() => {
    assistantRunState.__resetForTests();
  });

  it("stores resolved run metadata until the run finishes", () => {
    assistantRunState.startRun("session-1", {
      startedAt: 100,
      configuredAgent: "plan",
      configuredProviderID: "openai",
      configuredModelID: "gpt-5",
    });

    assistantRunState.markResponseCompleted("session-1", {
      agent: "build",
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
    });

    expect(assistantRunState.finishRun("session-1", "done")).toEqual({
      sessionId: "session-1",
      startedAt: 100,
      configuredAgent: "plan",
      configuredProviderID: "openai",
      configuredModelID: "gpt-5",
      actualAgent: "build",
      actualProviderID: "anthropic",
      actualModelID: "claude-sonnet-4",
      hasCompletedResponse: true,
    });
  });
});
