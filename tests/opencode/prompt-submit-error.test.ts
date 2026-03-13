import { describe, expect, it } from "vitest";
import { classifyPromptSubmitError } from "../../src/opencode/prompt-submit-error.js";

describe("opencode/prompt-submit-error", () => {
  it("classifies 409 responses as busy", () => {
    const result = classifyPromptSubmitError({
      name: "APIError",
      data: {
        statusCode: 409,
        message: "Session is busy",
      },
    });

    expect(result).toBe("busy");
  });

  it("classifies not-found style messages as missing session", () => {
    const result = classifyPromptSubmitError({
      data: {
        message: "Session not found",
      },
    });

    expect(result).toBe("session_not_found");
  });

  it("classifies unknown errors as other", () => {
    const result = classifyPromptSubmitError(new Error("socket hang up"));

    expect(result).toBe("other");
  });
});
