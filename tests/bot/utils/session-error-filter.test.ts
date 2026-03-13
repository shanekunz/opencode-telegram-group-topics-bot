import { describe, expect, it } from "vitest";
import {
  isOperationAbortedSessionError,
  SessionErrorThrottle,
} from "../../../src/bot/utils/session-error-filter.js";

describe("bot/utils/session-error-filter", () => {
  it("detects operation aborted messages", () => {
    expect(isOperationAbortedSessionError("The operation was aborted.")).toBe(true);
    expect(isOperationAbortedSessionError("AbortError: stream closed")).toBe(true);
    expect(isOperationAbortedSessionError("Network timeout")).toBe(false);
  });

  it("suppresses repeated identical errors within window", () => {
    const throttle = new SessionErrorThrottle(3000);

    expect(throttle.shouldSuppress("session-1", "Transient failure", 1000)).toBe(false);
    expect(throttle.shouldSuppress("session-1", "Transient failure", 2000)).toBe(true);
    expect(throttle.shouldSuppress("session-1", "Different failure", 2200)).toBe(false);
    expect(throttle.shouldSuppress("session-1", "Different failure", 6001)).toBe(false);
  });
});
