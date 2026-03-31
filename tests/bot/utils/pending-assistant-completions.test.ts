import { describe, expect, it } from "vitest";
import { PendingAssistantCompletions } from "../../../src/bot/utils/pending-assistant-completions.js";

describe("bot/utils/pending-assistant-completions", () => {
  it("keeps only the latest completion per session", () => {
    const store = new PendingAssistantCompletions();

    store.enqueue("s1", "First");
    store.enqueue("s1", "Second");
    store.enqueue("s2", "Other");

    expect(store.peek("s1")).toBe("Second");
    expect(store.peek("s2")).toBe("Other");
    store.clear("s1");
    expect(store.peek("s1")).toBeNull();
  });

  it("ignores empty completions", () => {
    const store = new PendingAssistantCompletions();

    store.enqueue("s1", "   ");

    expect(store.peek("s1")).toBeNull();
  });
});
