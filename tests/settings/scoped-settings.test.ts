import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetSettingsForTests,
  setCurrentProject,
  getCurrentProject,
  setCurrentAgent,
  getCurrentAgent,
  setCurrentModel,
  getCurrentModel,
  setCurrentSession,
  getCurrentSession,
  setScopedPinnedMessageId,
  getScopedPinnedMessageId,
} from "../../src/settings/manager.js";

describe("settings scoped values", () => {
  beforeEach(() => {
    __resetSettingsForTests();
  });

  it("stores project per scope", () => {
    setCurrentProject({ id: "p-global", worktree: "/global" });
    setCurrentProject({ id: "p-a", worktree: "/a" }, "chat:1:10");
    setCurrentProject({ id: "p-b", worktree: "/b" }, "chat:1:20");

    expect(getCurrentProject("chat:1:10")?.id).toBe("p-a");
    expect(getCurrentProject("chat:1:20")?.id).toBe("p-b");
    expect(getCurrentProject("global")?.id).toBe("p-global");
  });

  it("stores agent and model per scope", () => {
    setCurrentAgent("build");
    setCurrentModel({ providerID: "openai", modelID: "gpt-4", variant: "default" });

    setCurrentAgent("review", "dm:100");
    setCurrentModel({ providerID: "openai", modelID: "gpt-5", variant: "high" }, "dm:100");

    expect(getCurrentAgent("dm:100")).toBe("review");
    expect(getCurrentModel("dm:100")?.modelID).toBe("gpt-5");

    expect(getCurrentAgent("chat:999")).toBeUndefined();
    expect(getCurrentModel("chat:999")).toBeUndefined();

    expect(getCurrentAgent("global")).toBe("build");
    expect(getCurrentModel("global")?.modelID).toBe("gpt-4");
  });

  it("stores session and pinned message per scope", () => {
    setCurrentSession({ id: "ses-global", title: "Global", directory: "/global" });
    setCurrentSession({ id: "ses-topic", title: "Topic", directory: "/topic" }, "-100:22");
    setScopedPinnedMessageId("chat:-100", 10);
    setScopedPinnedMessageId("-100:22", 20);

    expect(getCurrentSession("global")?.id).toBe("ses-global");
    expect(getCurrentSession("-100:22")?.id).toBe("ses-topic");
    expect(getScopedPinnedMessageId("chat:-100")).toBe(10);
    expect(getScopedPinnedMessageId("-100:22")).toBe(20);
  });

  it("normalizes general-topic aliases to the chat general scope", () => {
    setCurrentProject({ id: "p-general", worktree: "/general" }, "-100:1");

    expect(getCurrentProject("-100:1")?.id).toBe("p-general");
    expect(getCurrentProject("chat:-100")?.id).toBe("p-general");
  });
});
