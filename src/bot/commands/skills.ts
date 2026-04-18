import { CommandContext, Context, InlineKeyboard } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentProject } from "../../settings/manager.js";
import { interactionManager } from "../../interaction/manager.js";
import type { InteractionState } from "../../interaction/types.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { config } from "../../config.js";
import { processUserPrompt, type ProcessPromptDeps } from "../handlers/prompt.js";
import { getScopeKeyFromContext } from "../scope.js";

const SKILLS_CALLBACK_PREFIX = "skills:";
const SKILLS_CALLBACK_SELECT_PREFIX = `${SKILLS_CALLBACK_PREFIX}select:`;
const SKILLS_CALLBACK_PAGE_PREFIX = `${SKILLS_CALLBACK_PREFIX}page:`;
const SKILLS_CALLBACK_CANCEL = `${SKILLS_CALLBACK_PREFIX}cancel`;
const SKILLS_CALLBACK_EXECUTE = `${SKILLS_CALLBACK_PREFIX}execute`;
const MAX_INLINE_BUTTON_LABEL_LENGTH = 64;

interface SkillItem {
  name: string;
  description?: string;
}

interface SkillsListMetadata {
  flow: "skills";
  stage: "list";
  messageId: number;
  projectDirectory: string;
  skills: SkillItem[];
  page: number;
}

interface SkillsConfirmMetadata {
  flow: "skills";
  stage: "confirm";
  messageId: number;
  projectDirectory: string;
  skillName: string;
}

type SkillsMetadata = SkillsListMetadata | SkillsConfirmMetadata;

interface ExecuteSkillParams {
  projectDirectory: string;
  skillName: string;
  argumentsText: string;
}

interface ExecutingSkillMessage {
  text: string;
  entities: Array<{
    type: "code";
    offset: number;
    length: number;
  }>;
}

function formatExecutingSkillMessage(skillName: string, args: string): ExecutingSkillMessage {
  const prefix = t("skills.executing_prefix");
  const skillText = `/${skillName}`;
  const argsSuffix = args ? ` ${args}` : "";
  return {
    text: `${prefix}\n${skillText}${argsSuffix}`,
    entities: [
      {
        type: "code",
        offset: prefix.length + 1,
        length: skillText.length,
      },
    ],
  };
}

export function buildSkillPageCallback(page: number): string {
  return `${SKILLS_CALLBACK_PAGE_PREFIX}${page}`;
}

export function parseSkillPageCallback(data: string): number | null {
  if (!data.startsWith(SKILLS_CALLBACK_PAGE_PREFIX)) {
    return null;
  }

  const rawPage = data.slice(SKILLS_CALLBACK_PAGE_PREFIX.length);
  const page = Number(rawPage);
  if (!Number.isInteger(page) || page < 0) {
    return null;
  }

  return page;
}

export function formatSkillsSelectText(page: number): string {
  if (page === 0) {
    return t("skills.select");
  }

  return t("skills.select_page", { page: page + 1 });
}

function normalizeDirectoryForCommandApi(directory: string): string {
  return directory.replace(/\\/g, "/");
}

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

function formatSkillButtonLabel(skill: SkillItem): string {
  const description = skill.description?.trim() || t("skills.no_description");
  const rawLabel = `/${skill.name} - ${description}`;

  if (rawLabel.length <= MAX_INLINE_BUTTON_LABEL_LENGTH) {
    return rawLabel;
  }

  return `${rawLabel.slice(0, MAX_INLINE_BUTTON_LABEL_LENGTH - 3)}...`;
}

export interface SkillsPaginationRange {
  page: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
}

export function calculateSkillsPaginationRange(
  totalSkills: number,
  page: number,
  pageSize: number,
): SkillsPaginationRange {
  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(totalSkills / safePageSize));
  const normalizedPage = Math.min(Math.max(0, page), totalPages - 1);
  const startIndex = normalizedPage * safePageSize;
  const endIndex = Math.min(startIndex + safePageSize, totalSkills);

  return {
    page: normalizedPage,
    totalPages,
    startIndex,
    endIndex,
  };
}

function buildSkillsListKeyboard(
  skills: SkillItem[],
  page: number,
  pageSize: number,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const {
    page: normalizedPage,
    totalPages,
    startIndex,
    endIndex,
  } = calculateSkillsPaginationRange(skills.length, page, pageSize);

  skills.slice(startIndex, endIndex).forEach((skill, index) => {
    const globalIndex = startIndex + index;
    keyboard
      .text(formatSkillButtonLabel(skill), `${SKILLS_CALLBACK_SELECT_PREFIX}${globalIndex}`)
      .row();
  });

  if (totalPages > 1) {
    if (normalizedPage > 0) {
      keyboard.text(t("skills.button.prev_page"), buildSkillPageCallback(normalizedPage - 1));
    }

    if (normalizedPage < totalPages - 1) {
      keyboard.text(t("skills.button.next_page"), buildSkillPageCallback(normalizedPage + 1));
    }

    keyboard.row();
  }

  keyboard.text(t("skills.button.cancel"), SKILLS_CALLBACK_CANCEL);
  return keyboard;
}

function buildSkillsConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("skills.button.execute"), SKILLS_CALLBACK_EXECUTE)
    .text(t("skills.button.cancel"), SKILLS_CALLBACK_CANCEL);
}

function parseSkillItems(value: unknown): SkillItem[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const skills: SkillItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      return null;
    }

    const skillName = (item as { name?: unknown }).name;
    if (typeof skillName !== "string" || !skillName.trim()) {
      return null;
    }

    const description = (item as { description?: unknown }).description;
    skills.push({
      name: skillName,
      description: typeof description === "string" ? description : undefined,
    });
  }

  return skills;
}

function parseSkillsMetadata(state: InteractionState | null): SkillsMetadata | null {
  if (!state || state.kind !== "custom") {
    return null;
  }

  const flow = state.metadata.flow;
  const stage = state.metadata.stage;
  const messageId = state.metadata.messageId;
  const projectDirectory = state.metadata.projectDirectory;

  if (flow !== "skills" || typeof messageId !== "number" || typeof projectDirectory !== "string") {
    return null;
  }

  if (stage === "list") {
    const skills = parseSkillItems(state.metadata.skills);
    if (!skills) {
      return null;
    }

    const page =
      typeof state.metadata.page === "number" && Number.isInteger(state.metadata.page)
        ? Math.max(0, state.metadata.page)
        : 0;

    return { flow, stage, messageId, projectDirectory, skills, page };
  }

  if (stage === "confirm") {
    const skillName = state.metadata.skillName;
    if (typeof skillName !== "string" || !skillName.trim()) {
      return null;
    }

    return { flow, stage, messageId, projectDirectory, skillName };
  }

  return null;
}

function clearSkillsInteraction(reason: string, scopeKey: string): void {
  const metadata = parseSkillsMetadata(interactionManager.getSnapshot(scopeKey));
  if (metadata) {
    interactionManager.clear(reason, scopeKey);
  }
}

async function getSkillList(projectDirectory: string): Promise<SkillItem[]> {
  const { data, error } = await opencodeClient.command.list({
    directory: normalizeDirectoryForCommandApi(projectDirectory),
  });

  if (error || !data) {
    throw error || new Error("No skill data received");
  }

  return data
    .filter((skill) => {
      const source = (skill as { source?: unknown }).source;
      return typeof skill.name === "string" && skill.name.trim().length > 0 && source === "skill";
    })
    .map((skill) => ({ name: skill.name, description: skill.description }));
}

function parseSelectIndex(data: string): number | null {
  if (!data.startsWith(SKILLS_CALLBACK_SELECT_PREFIX)) {
    return null;
  }

  const rawIndex = data.slice(SKILLS_CALLBACK_SELECT_PREFIX.length);
  const index = Number(rawIndex);
  if (!Number.isInteger(index) || index < 0) {
    return null;
  }

  return index;
}

async function executeSkill(
  ctx: Context,
  deps: ProcessPromptDeps,
  params: ExecuteSkillParams,
): Promise<void> {
  const scopeKey = getScopeKeyFromContext(ctx);
  const currentProject = getCurrentProject(scopeKey);
  if (!currentProject) {
    await ctx.reply(t("bot.project_not_selected"));
    return;
  }

  if (currentProject.worktree !== params.projectDirectory) {
    logger.warn(
      `[Skills] Project changed between selection and execution. listedProject=${params.projectDirectory}, currentProject=${currentProject.worktree}. Using current project.`,
    );
  }

  const args = params.argumentsText.trim();
  const executingMessage = formatExecutingSkillMessage(params.skillName, args);
  await ctx.reply(executingMessage.text, { entities: executingMessage.entities });

  const promptText = args ? `/${params.skillName} ${args}` : `/${params.skillName}`;
  await processUserPrompt(ctx, promptText, deps);
}

export async function skillsCommand(ctx: CommandContext<Context>): Promise<void> {
  const scopeKey = getScopeKeyFromContext(ctx);

  try {
    const currentProject = getCurrentProject(scopeKey);
    if (!currentProject) {
      await ctx.reply(t("bot.project_not_selected"));
      return;
    }

    const skills = await getSkillList(currentProject.worktree);
    if (skills.length === 0) {
      await ctx.reply(t("skills.empty"));
      return;
    }

    const pageSize = config.bot.commandsListLimit;
    const keyboard = buildSkillsListKeyboard(skills, 0, pageSize);
    const message = await ctx.reply(formatSkillsSelectText(0), { reply_markup: keyboard });

    interactionManager.start(
      {
        kind: "custom",
        expectedInput: "callback",
        metadata: {
          flow: "skills",
          stage: "list",
          messageId: message.message_id,
          projectDirectory: currentProject.worktree,
          skills,
          page: 0,
        },
      },
      scopeKey,
    );
  } catch (error) {
    logger.error("[Skills] Error fetching skills list:", error);
    await ctx.reply(t("skills.fetch_error"));
  }
}

export async function handleSkillsCallback(
  ctx: Context,
  deps: ProcessPromptDeps,
): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(SKILLS_CALLBACK_PREFIX)) {
    return false;
  }

  const scopeKey = getScopeKeyFromContext(ctx);
  const metadata = parseSkillsMetadata(interactionManager.getSnapshot(scopeKey));
  const callbackMessageId = getCallbackMessageId(ctx);

  if (!metadata || callbackMessageId === null || metadata.messageId !== callbackMessageId) {
    await ctx.answerCallbackQuery({ text: t("skills.inactive_callback"), show_alert: true });
    return true;
  }

  try {
    if (data === SKILLS_CALLBACK_CANCEL) {
      clearSkillsInteraction("skills_cancelled", scopeKey);
      await ctx.answerCallbackQuery({ text: t("skills.cancelled_callback") });
      await ctx.deleteMessage().catch(() => {});
      return true;
    }

    if (data === SKILLS_CALLBACK_EXECUTE) {
      if (metadata.stage !== "confirm") {
        await ctx.answerCallbackQuery({ text: t("skills.inactive_callback"), show_alert: true });
        return true;
      }

      clearSkillsInteraction("skills_execute_clicked", scopeKey);
      await ctx.answerCallbackQuery({ text: t("skills.execute_callback") });
      await ctx.deleteMessage().catch(() => {});

      await executeSkill(ctx, deps, {
        projectDirectory: metadata.projectDirectory,
        skillName: metadata.skillName,
        argumentsText: "",
      });
      return true;
    }

    const page = parseSkillPageCallback(data);
    if (page !== null) {
      if (metadata.stage !== "list") {
        await ctx.answerCallbackQuery({ text: t("callback.processing_error"), show_alert: true });
        return true;
      }

      const pageSize = config.bot.commandsListLimit;
      const { page: normalizedPage, totalPages } = calculateSkillsPaginationRange(
        metadata.skills.length,
        page,
        pageSize,
      );

      if (page >= totalPages || page < 0) {
        await ctx.answerCallbackQuery({ text: t("skills.page_empty_callback") });
        return true;
      }

      const keyboard = buildSkillsListKeyboard(metadata.skills, normalizedPage, pageSize);
      await ctx.editMessageText(formatSkillsSelectText(normalizedPage), { reply_markup: keyboard });
      await ctx.answerCallbackQuery();

      interactionManager.transition(
        {
          expectedInput: "callback",
          metadata: {
            flow: "skills",
            stage: "list",
            messageId: metadata.messageId,
            projectDirectory: metadata.projectDirectory,
            skills: metadata.skills,
            page: normalizedPage,
          },
        },
        scopeKey,
      );

      return true;
    }

    const skillIndex = parseSelectIndex(data);
    if (skillIndex === null || metadata.stage !== "list") {
      await ctx.answerCallbackQuery({ text: t("callback.processing_error"), show_alert: true });
      return true;
    }

    const selectedSkill = metadata.skills[skillIndex];
    if (!selectedSkill) {
      await ctx.answerCallbackQuery({ text: t("skills.inactive_callback"), show_alert: true });
      return true;
    }

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t("skills.confirm", { skill: `/${selectedSkill.name}` }), {
      reply_markup: buildSkillsConfirmKeyboard(),
    });

    interactionManager.transition(
      {
        expectedInput: "mixed",
        metadata: {
          flow: "skills",
          stage: "confirm",
          messageId: metadata.messageId,
          projectDirectory: metadata.projectDirectory,
          skillName: selectedSkill.name,
        },
      },
      scopeKey,
    );

    return true;
  } catch (error) {
    logger.error("[Skills] Error handling skill callback:", error);
    clearSkillsInteraction("skills_callback_error", scopeKey);
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    return true;
  }
}

export async function handleSkillTextArguments(
  ctx: Context,
  deps: ProcessPromptDeps,
): Promise<boolean> {
  const text = ctx.message?.text;
  if (!text || text.startsWith("/")) {
    return false;
  }

  const scopeKey = getScopeKeyFromContext(ctx);
  const metadata = parseSkillsMetadata(interactionManager.getSnapshot(scopeKey));
  if (!metadata || metadata.stage !== "confirm") {
    return false;
  }

  const argumentsText = text.trim();
  if (!argumentsText) {
    await ctx.reply(t("skills.arguments_empty"));
    return true;
  }

  clearSkillsInteraction("skills_arguments_submitted", scopeKey);

  if (ctx.chat) {
    await ctx.api.deleteMessage(ctx.chat.id, metadata.messageId).catch(() => {});
  }

  await executeSkill(ctx, deps, {
    projectDirectory: metadata.projectDirectory,
    skillName: metadata.skillName,
    argumentsText,
  });

  return true;
}
