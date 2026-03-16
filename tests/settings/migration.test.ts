import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setRuntimeMode } from "../../src/runtime/mode.js";
import {
  __resetSettingsForTests,
  __waitForSettingsWritesForTests,
  getCurrentAgent,
  getCurrentModel,
  getCurrentProject,
  getCurrentSession,
  getScopedPinnedMessageId,
  getTopicSessionBinding,
  loadSettings,
  setCurrentAgent,
  setCurrentProject,
  setCurrentSession,
  setScopedPinnedMessageId,
  setTopicSessionBinding,
  TOPIC_SESSION_STATUS,
} from "../../src/settings/manager.js";

describe("settings migration", () => {
  let tempHome: string;
  let settingsPath: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "opencode-telegram-settings-"));
    settingsPath = path.join(tempHome, "settings.json");
    process.env.OPENCODE_TELEGRAM_HOME = tempHome;
    setRuntimeMode("installed");
    __resetSettingsForTests();
  });

  afterEach(async () => {
    __resetSettingsForTests();
    delete process.env.OPENCODE_TELEGRAM_HOME;
    await rm(tempHome, { recursive: true, force: true });
  });

  it("migrates v1 flat settings to nested v2 on load", async () => {
    await writeFile(
      settingsPath,
      JSON.stringify(
        {
          scopedProjects: {
            "chat:-1001": { id: "proj-general", worktree: "/repo/general" },
            "-1001:22": { id: "proj-topic", worktree: "/repo/topic" },
          },
          scopedSessions: {
            "-1001:22": { id: "ses-topic", title: "Topic Session", directory: "/repo/topic" },
          },
          scopedAgents: {
            "chat:-1001": "plan",
          },
          scopedModels: {
            "-1001:22": { providerID: "openai", modelID: "gpt-5", variant: "default" },
          },
          scopedPinnedMessageIds: {
            "chat:-1001": 77,
          },
          topicSessionBindings: {
            "-1001:22": {
              scopeKey: "-1001:22",
              chatId: -1001,
              threadId: 22,
              sessionId: "ses-topic",
              projectId: "proj-topic",
              projectWorktree: "/repo/topic",
              topicName: "Topic Session",
              status: "active",
              createdAt: 100,
              updatedAt: 200,
            },
          },
        },
        null,
        2,
      ),
    );

    await loadSettings();

    expect(getCurrentProject("chat:-1001")?.id).toBe("proj-general");
    expect(getCurrentProject("-1001:22")?.id).toBe("proj-topic");
    expect(getCurrentSession("-1001:22")?.id).toBe("ses-topic");
    expect(getCurrentAgent("chat:-1001")).toBe("plan");
    expect(getCurrentModel("-1001:22")?.modelID).toBe("gpt-5");
    expect(getScopedPinnedMessageId("chat:-1001")).toBe(77);
    expect(getTopicSessionBinding("-1001:22")?.sessionId).toBe("ses-topic");

    const migrated = JSON.parse(await readFile(settingsPath, "utf-8")) as {
      settingsVersion: number;
      groups: Record<
        string,
        {
          general?: { project?: { id: string }; agent?: string; pinnedMessageId?: number };
          topics?: Record<
            string,
            {
              project?: { id: string };
              session?: { id: string };
              model?: { modelID: string };
              binding?: { sessionId: string };
            }
          >;
        }
      >;
      scopedProjects?: unknown;
    };

    expect(migrated.settingsVersion).toBe(2);
    expect(migrated.scopedProjects).toBeUndefined();
    expect(migrated.groups["-1001"]?.general?.project?.id).toBe("proj-general");
    expect(migrated.groups["-1001"]?.general?.agent).toBe("plan");
    expect(migrated.groups["-1001"]?.general?.pinnedMessageId).toBe(77);
    expect(migrated.groups["-1001"]?.topics?.["22"]?.project?.id).toBe("proj-topic");
    expect(migrated.groups["-1001"]?.topics?.["22"]?.session?.id).toBe("ses-topic");
    expect(migrated.groups["-1001"]?.topics?.["22"]?.model?.modelID).toBe("gpt-5");
    expect(migrated.groups["-1001"]?.topics?.["22"]?.binding?.sessionId).toBe("ses-topic");
  });

  it("writes new mutations directly into nested v2 structure", async () => {
    await loadSettings();

    setCurrentProject({ id: "proj-general", worktree: "/repo/general" }, "chat:-2002");
    setCurrentAgent("build", "chat:-2002");
    setCurrentSession({ id: "ses-topic", title: "Topic", directory: "/repo/general" }, "-2002:44");
    setScopedPinnedMessageId("-2002:44", 55);
    setTopicSessionBinding("-2002:44", {
      scopeKey: "-2002:44",
      chatId: -2002,
      threadId: 44,
      sessionId: "ses-topic",
      projectId: "proj-general",
      projectWorktree: "/repo/general",
      status: TOPIC_SESSION_STATUS.ACTIVE,
      createdAt: 1,
      updatedAt: 2,
    });

    await __waitForSettingsWritesForTests();

    const stored = JSON.parse(await readFile(settingsPath, "utf-8")) as {
      settingsVersion: number;
      groups: Record<
        string,
        {
          general?: { project?: { id: string }; agent?: string };
          topics?: Record<
            string,
            {
              session?: { id: string };
              pinnedMessageId?: number;
              binding?: { sessionId: string; projectId: string };
            }
          >;
        }
      >;
    };

    expect(stored.settingsVersion).toBe(2);
    expect(stored.groups["-2002"]?.general?.project?.id).toBe("proj-general");
    expect(stored.groups["-2002"]?.general?.agent).toBe("build");
    expect(stored.groups["-2002"]?.topics?.["44"]?.session?.id).toBe("ses-topic");
    expect(stored.groups["-2002"]?.topics?.["44"]?.pinnedMessageId).toBe(55);
    expect(stored.groups["-2002"]?.topics?.["44"]?.binding?.sessionId).toBe("ses-topic");
    expect(stored.groups["-2002"]?.topics?.["44"]?.binding?.projectId).toBe("proj-general");
  });

  it("upgrades nested settings without version metadata instead of wiping them", async () => {
    await writeFile(
      settingsPath,
      JSON.stringify(
        {
          groups: {
            "-3003": {
              general: {
                project: { id: "proj-general", worktree: "/repo/general" },
              },
              topics: {
                "9": {
                  session: { id: "ses-topic", title: "Topic", directory: "/repo/general" },
                },
              },
            },
          },
        },
        null,
        2,
      ),
    );

    await loadSettings();

    expect(getCurrentProject("chat:-3003")?.id).toBe("proj-general");
    expect(getCurrentSession("-3003:9")?.id).toBe("ses-topic");

    const upgraded = JSON.parse(await readFile(settingsPath, "utf-8")) as {
      settingsVersion: number;
      groups: Record<string, unknown>;
    };

    expect(upgraded.settingsVersion).toBe(2);
    expect(upgraded.groups["-3003"]).toBeDefined();
  });

  it("does not rewrite unknown future settings versions", async () => {
    const original = {
      settingsVersion: 3,
      groups: {
        "-4004": {
          general: {
            project: { id: "proj-general", worktree: "/repo/general" },
          },
        },
      },
      futureField: { preserved: true },
    };

    await writeFile(settingsPath, JSON.stringify(original, null, 2));

    await loadSettings();

    expect(getCurrentProject("chat:-4004")?.id).toBe("proj-general");
    expect(getCurrentAgent("chat:-4004")).toBeUndefined();

    setCurrentAgent("build", "chat:-4004");
    await __waitForSettingsWritesForTests();

    expect(getCurrentAgent("chat:-4004")).toBeUndefined();

    const afterLoad = JSON.parse(await readFile(settingsPath, "utf-8")) as typeof original;
    expect(afterLoad).toEqual(original);
  });

  it("rejects mismatched topic binding keys", () => {
    expect(() =>
      setTopicSessionBinding("-5005:88", {
        scopeKey: "-5005:89",
        chatId: -5005,
        threadId: 89,
        sessionId: "ses-topic",
        projectId: "proj-general",
        projectWorktree: "/repo/general",
        status: TOPIC_SESSION_STATUS.ACTIVE,
        createdAt: 1,
        updatedAt: 2,
      }),
    ).toThrow(/Topic binding key mismatch/);
  });

  it("rejects mismatched topic binding scope keys", () => {
    expect(() =>
      setTopicSessionBinding("-5005:89", {
        scopeKey: "-5005:90",
        chatId: -5005,
        threadId: 89,
        sessionId: "ses-topic",
        projectId: "proj-general",
        projectWorktree: "/repo/general",
        status: TOPIC_SESSION_STATUS.ACTIVE,
        createdAt: 1,
        updatedAt: 2,
      }),
    ).toThrow(/Topic binding scope mismatch/);
  });

  it("drops legacy bindings whose scope key disagrees with chat and thread", async () => {
    await writeFile(
      settingsPath,
      JSON.stringify(
        {
          scopedSessions: {
            "-6006:12": { id: "ses-topic", title: "Topic Session", directory: "/repo/topic" },
          },
          scopedProjects: {
            "-6006:12": { id: "proj-topic", worktree: "/repo/topic" },
          },
          topicSessionBindings: {
            "-6006:12": {
              scopeKey: "-6006:13",
              chatId: -6006,
              threadId: 12,
              sessionId: "ses-topic",
              projectId: "proj-topic",
              projectWorktree: "/repo/topic",
              status: "active",
              createdAt: 100,
              updatedAt: 200,
            },
          },
        },
        null,
        2,
      ),
    );

    await loadSettings();

    expect(getCurrentSession("-6006:12")?.id).toBe("ses-topic");
    expect(getCurrentProject("-6006:12")?.id).toBe("proj-topic");
    expect(getTopicSessionBinding("-6006:12")).toBeUndefined();
  });
});
