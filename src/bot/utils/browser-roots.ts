import path from "node:path";
import os from "node:os";
import { logger } from "../../utils/logger.js";
import { config } from "../../config.js";

let resolvedRoots: string[] | null = null;

function isWindows(): boolean {
  return process.platform === "win32";
}

function expandTilde(value: string): string {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

function normalizePath(value: string): string {
  const resolved = path.resolve(expandTilde(value));
  return isWindows() ? resolved.toLowerCase() : resolved;
}

function initBrowserRoots(): void {
  const raw = config.bot.openBrowserRoots;

  if (!raw || raw.trim() === "") {
    resolvedRoots = [normalizePath(os.homedir())];
    logger.debug(
      `[BrowserRoots] No OPEN_BROWSER_ROOTS configured, defaulting to home: ${resolvedRoots[0]}`,
    );
    return;
  }

  const roots = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => normalizePath(entry));

  if (roots.length === 0) {
    resolvedRoots = [normalizePath(os.homedir())];
    logger.warn("[BrowserRoots] All configured roots were invalid, falling back to home");
    return;
  }

  resolvedRoots = roots;
  logger.info(`[BrowserRoots] Configured roots: ${roots.join(", ")}`);
}

export function getBrowserRoots(): string[] {
  if (resolvedRoots === null) {
    initBrowserRoots();
  }

  return resolvedRoots ? [...resolvedRoots] : [];
}

export function isWithinAllowedRoot(targetPath: string): boolean {
  const normalizedTarget = normalizePath(targetPath);

  return getBrowserRoots().some(
    (root) =>
      normalizedTarget === root ||
      normalizedTarget.startsWith(`${root}/`) ||
      normalizedTarget.startsWith(`${root}\\`),
  );
}

export function isAllowedRoot(targetPath: string): boolean {
  const normalizedTarget = normalizePath(targetPath);
  return getBrowserRoots().includes(normalizedTarget);
}

export function __resetBrowserRootsForTests(): void {
  resolvedRoots = null;
}
