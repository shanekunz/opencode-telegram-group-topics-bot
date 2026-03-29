import { describe, expect, it } from "vitest";
import { keyboardManager } from "../../src/keyboard/manager.js";
import { pinnedMessageManager } from "../../src/pinned/manager.js";

function getButtonText(button: string | { text: string }): string {
  return typeof button === "string" ? button : button.text;
}

describe("keyboard/manager", () => {
  it("prefers pinned context info over stale keyboard state for topic scopes", () => {
    const scopeKey = "-100123:77";

    keyboardManager.updateAgent("build", scopeKey);
    keyboardManager.updateModel(
      {
        providerID: "openai",
        modelID: "gpt-5.4",
        variant: "default",
      },
      scopeKey,
    );
    keyboardManager.updateContext(0, 1_100_000, scopeKey);

    const pinnedContexts = (
      pinnedMessageManager as unknown as {
        contexts: Map<
          string,
          { state: { tokensUsed: number; tokensLimit: number }; contextLimit: number }
        >;
      }
    ).contexts;

    pinnedContexts.set(scopeKey, {
      state: {
        tokensUsed: 42_000,
        tokensLimit: 1_100_000,
      },
      contextLimit: 1_100_000,
    });

    const keyboard = keyboardManager.getKeyboard(scopeKey);

    expect(keyboard).toBeDefined();
    expect(getButtonText(keyboard!.keyboard[0][0])).toBe("📊 42K / 1.1M (4%)");

    pinnedContexts.delete(scopeKey);
  });
});
