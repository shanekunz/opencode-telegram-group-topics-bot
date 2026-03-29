import { describe, expect, it } from "vitest";
import { renderSubagentCards } from "../../src/summary/subagent-formatter.js";

describe("summary/subagent-formatter", () => {
  it("renders subagent cards with task, agent, model, and activity", () => {
    const rendered = renderSubagentCards([
      {
        cardId: "card-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        agent: "explore",
        description: "Inspect upstream diff",
        prompt: "Inspect upstream diff",
        status: "running",
        providerID: "openai",
        modelID: "gpt-5",
        currentTool: "read",
        currentToolInput: { filePath: "src/summary/aggregator.ts" },
        currentToolTitle: undefined,
        terminalMessage: undefined,
        updatedAt: Date.now(),
      },
    ]);

    expect(rendered).toContain("🧩 Task: Inspect upstream diff");
    expect(rendered).toContain("Agent: explore");
    expect(rendered).toContain("Model: openai/gpt-5");
    expect(rendered).toContain("read src/summary/aggregator.ts");
  });
});
