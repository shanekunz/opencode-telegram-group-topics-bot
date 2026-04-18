import { describe, expect, it } from "vitest";
import { formatAssistantRunFooter } from "../../../src/bot/utils/assistant-run-footer.js";

describe("bot/utils/assistant-run-footer", () => {
  it("formats agent, model, and elapsed time", () => {
    const footer = formatAssistantRunFooter(
      {
        sessionId: "s1",
        startedAt: 1000,
        configuredAgent: "build",
        configuredProviderID: "openai",
        configuredModelID: "gpt-5",
      },
      3500,
    );

    expect(footer).toBe("🛠️ Build · 🤖 openai/gpt-5 · 🕒 2.5s");
  });
});
