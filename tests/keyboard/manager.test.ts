import { describe, expect, it } from "vitest";
import { keyboardManager } from "../../src/keyboard/manager.js";
import { contextStateManager } from "../../src/context/manager.js";

function getButtonText(button: string | { text: string }): string {
  return typeof button === "string" ? button : button.text;
}

describe("keyboard/manager", () => {
  it("uses shared context state for topic scopes", () => {
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

    contextStateManager.update(42_000, 1_100_000, scopeKey);

    const keyboard = keyboardManager.getKeyboard(scopeKey);

    expect(keyboard).toBeDefined();
    expect(getButtonText(keyboard!.keyboard[0][0])).toBe("📊 42K / 1.1M (4%)");

    contextStateManager.clear(scopeKey);
  });
});
