import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetSettingsForTests,
  setCurrentProject,
  getCurrentProject,
  setCurrentAgent,
  getCurrentAgent,
  setCurrentModel,
  getCurrentModel,
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
});
