import { describe, expect, it } from "vitest";
import {
  AGENT_EMOJI,
  getAgentButtonLabel,
  getAgentDisplayName,
  getAgentEmoji,
} from "../../src/agent/types.js";

describe("agent/types", () => {
  it("returns mapped emoji for known agents", () => {
    expect(getAgentEmoji("build")).toBe("🛠️");
    expect(getAgentEmoji("plan")).toBe("📋");
    expect(AGENT_EMOJI.general).toBe("💬");
  });

  it("returns fallback emoji for unknown agents", () => {
    expect(getAgentEmoji("custom-agent")).toBe("🤖");
  });

  it("builds display name and button label with emoji", () => {
    expect(getAgentDisplayName("build")).toBe("🛠️ Build");
    expect(getAgentDisplayName("customAgent")).toBe("🤖 CustomAgent");
    expect(getAgentButtonLabel("build")).toBe("🛠️ Build Agent");
  });
});
