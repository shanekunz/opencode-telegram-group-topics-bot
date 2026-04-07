import { describe, expect, it } from "vitest";
import { PendingAssistantCompletions } from "../../../src/bot/utils/pending-assistant-completions.js";

describe("bot/utils/pending-assistant-completions", () => {
  it("preserves multiple completions in enqueue order", () => {
    const pending = new PendingAssistantCompletions();

    pending.enqueue("s1", "First");
    pending.enqueue("s1", "Second");

    expect(pending.consume("s1")).toEqual(["First", "Second"]);
  });

  it("prepends undelivered completions ahead of newer ones", () => {
    const pending = new PendingAssistantCompletions();

    pending.enqueue("s1", "Third");
    pending.prepend("s1", ["First", "Second"]);

    expect(pending.consume("s1")).toEqual(["First", "Second", "Third"]);
  });

  it("reports whether a session still has pending completions", () => {
    const pending = new PendingAssistantCompletions();

    expect(pending.has("s1")).toBe(false);

    pending.enqueue("s1", "First");
    expect(pending.has("s1")).toBe(true);

    pending.clear("s1");
    expect(pending.has("s1")).toBe(false);
  });
});
