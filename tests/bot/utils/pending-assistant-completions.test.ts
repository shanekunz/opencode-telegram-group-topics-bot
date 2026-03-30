import { describe, expect, it } from "vitest";
import { PendingAssistantCompletions } from "../../../src/bot/utils/pending-assistant-completions.js";

describe("bot/utils/pending-assistant-completions", () => {
  it("queues completions per session and consumes them in order", () => {
    const store = new PendingAssistantCompletions();

    store.enqueue("s1", "First");
    store.enqueue("s1", "Second");
    store.enqueue("s2", "Other");

    expect(store.consume("s1")).toEqual(["First", "Second"]);
    expect(store.consume("s1")).toEqual([]);
    expect(store.consume("s2")).toEqual(["Other"]);
  });

  it("ignores empty completions", () => {
    const store = new PendingAssistantCompletions();

    store.enqueue("s1", "   ");

    expect(store.consume("s1")).toEqual([]);
  });
});
