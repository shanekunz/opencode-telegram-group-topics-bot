import { describe, expect, it } from "vitest";
import { PendingAssistantCompletions } from "../../../src/bot/utils/pending-assistant-completions.js";

describe("bot/utils/pending-assistant-completions", () => {
  it("preserves completion order per session", () => {
    const store = new PendingAssistantCompletions();

    store.enqueue("s1", "First");
    store.enqueue("s1", "Second");
    store.enqueue("s2", "Other");

    expect(store.consume("s1")).toEqual(["First", "Second"]);
    expect(store.consume("s2")).toEqual(["Other"]);
    store.clear("s1");
    expect(store.consume("s1")).toEqual([]);
  });

  it("ignores empty completions", () => {
    const store = new PendingAssistantCompletions();

    store.enqueue("s1", "   ");

    expect(store.consume("s1")).toEqual([]);
  });
});
