import { beforeEach, describe, expect, it } from "vitest";
import { assistantRunState } from "../../src/bot/assistant-run-state.js";

describe("bot/assistant-run-state", () => {
  beforeEach(() => {
    assistantRunState.__resetForTests();
  });

  it("stores and returns the active run", () => {
    assistantRunState.startRun("s1", {
      startedAt: 123,
      configuredAgent: "build",
      configuredProviderID: "openai",
      configuredModelID: "gpt-5",
    });

    expect(assistantRunState.getRun("s1")).toEqual({
      sessionId: "s1",
      startedAt: 123,
      configuredAgent: "build",
      configuredProviderID: "openai",
      configuredModelID: "gpt-5",
    });
  });

  it("clears the run after finish", () => {
    assistantRunState.startRun("s1", { startedAt: 123 });

    expect(assistantRunState.finishRun("s1", "done")).toEqual({
      sessionId: "s1",
      startedAt: 123,
      configuredAgent: undefined,
      configuredProviderID: undefined,
      configuredModelID: undefined,
    });
    expect(assistantRunState.getRun("s1")).toBeNull();
  });
});
