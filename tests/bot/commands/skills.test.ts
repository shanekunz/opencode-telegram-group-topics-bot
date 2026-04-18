import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Context } from "grammy";
import {
  calculateSkillsPaginationRange,
  handleSkillTextArguments,
  handleSkillsCallback,
  skillsCommand,
} from "../../../src/bot/commands/skills.js";
import { interactionManager } from "../../../src/interaction/manager.js";
import { t } from "../../../src/i18n/index.js";
import type { ProcessPromptDeps } from "../../../src/bot/handlers/prompt.js";

const mocked = vi.hoisted(() => ({
  currentProject: {
    id: "project-1",
    worktree: "D:\\Projects\\Repo",
  } as { id: string; worktree: string } | null,
  commandListMock: vi.fn(),
  processUserPromptMock: vi.fn(),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getCurrentProject: vi.fn(() => mocked.currentProject),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    command: {
      list: mocked.commandListMock,
    },
  },
}));

vi.mock("../../../src/bot/handlers/prompt.js", () => ({
  processUserPrompt: mocked.processUserPromptMock,
}));

function createContext(messageId: number): Context {
  return {
    chat: { id: 777 },
    reply: vi.fn().mockResolvedValue({ message_id: messageId }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    api: {
      deleteMessage: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Context;
}

function createDeps(): ProcessPromptDeps {
  return {
    bot: {} as Bot<Context>,
    ensureEventSubscription: vi.fn(),
  };
}

describe("bot/commands/skills", () => {
  beforeEach(() => {
    interactionManager.clear("test_setup");
    mocked.currentProject = { id: "project-1", worktree: "D:\\Projects\\Repo" };
    mocked.commandListMock.mockReset();
    mocked.processUserPromptMock.mockReset();
    mocked.processUserPromptMock.mockResolvedValue(true);
  });

  it("shows skills list and starts custom interaction", async () => {
    mocked.commandListMock.mockResolvedValue({
      data: [
        { name: "borsch", description: "Cook borsch", source: "skill" },
        { name: "release", description: "Prepare release", source: "skill" },
        { name: "review", description: "Review changes", source: "command" },
      ],
      error: null,
    });

    const ctx = createContext(123);
    await skillsCommand(ctx as never);

    expect(mocked.commandListMock).toHaveBeenCalledWith({ directory: "D:/Projects/Repo" });
    expect(ctx.reply).toHaveBeenCalledTimes(1);

    const state = interactionManager.getSnapshot();
    expect(state?.kind).toBe("custom");
    expect(state?.metadata.flow).toBe("skills");
    expect(state?.metadata.skills).toEqual([
      { name: "borsch", description: "Cook borsch" },
      { name: "release", description: "Prepare release" },
    ]);
  });

  it("transitions to confirmation and executes via callback", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "skills",
        stage: "list",
        messageId: 321,
        projectDirectory: "D:\\Projects\\Repo",
        skills: [{ name: "release", description: "Prepare release" }],
      },
    });

    const callbackCtx = {
      ...createContext(321),
      callbackQuery: { data: "skills:select:0", message: { message_id: 321 } },
    } as unknown as Context;
    await handleSkillsCallback(callbackCtx, createDeps());

    expect(callbackCtx.editMessageText).toHaveBeenCalledWith(
      t("skills.confirm", { skill: "/release" }),
      expect.objectContaining({ reply_markup: expect.any(Object) }),
    );

    const executeCtx = {
      ...createContext(321),
      callbackQuery: { data: "skills:execute", message: { message_id: 321 } },
    } as unknown as Context;
    await handleSkillsCallback(executeCtx, createDeps());

    expect(mocked.processUserPromptMock).toHaveBeenCalledWith(
      executeCtx,
      "/release",
      expect.any(Object),
    );
  });

  it("executes selected skill with text arguments", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "mixed",
      metadata: {
        flow: "skills",
        stage: "confirm",
        messageId: 500,
        projectDirectory: "D:\\Projects\\Repo",
        skillName: "borsch",
      },
    });

    const ctx = {
      ...createContext(500),
      message: { text: "with garlic buns" },
    } as unknown as Context;

    const handled = await handleSkillTextArguments(ctx, createDeps());

    expect(handled).toBe(true);
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(777, 500);
    expect(mocked.processUserPromptMock).toHaveBeenCalledWith(
      ctx,
      "/borsch with garlic buns",
      expect.any(Object),
    );
  });

  it("calculates skill pagination safely", () => {
    expect(calculateSkillsPaginationRange(25, 2, 10)).toEqual({
      page: 2,
      totalPages: 3,
      startIndex: 20,
      endIndex: 25,
    });
  });
});
