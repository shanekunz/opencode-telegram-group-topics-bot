import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { logger } from "../../utils/logger.js";

let resolvedRoots: string[] | null = null;

function isWindows(): boolean {
  return process.platform === "win32";
}

function expandTilde(inputPath: string): string {
  if (inputPath === "~") {
    return os.homedir();
  }

  if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return inputPath;
}

function resolveConfiguredPath(inputPath: string): string {
  return path.resolve(expandTilde(inputPath));
}

function normalizePath(inputPath: string): string {
  const resolvedPath = resolveConfiguredPath(inputPath);
  return isWindows() ? resolvedPath.toLowerCase() : resolvedPath;
}

export function initBrowserRoots(raw?: string): void {
  if (!raw || raw.trim() === "") {
    resolvedRoots = [resolveConfiguredPath(os.homedir())];
    logger.debug(
      `[BrowserRoots] No OPEN_BROWSER_ROOTS configured, defaulting to home: ${resolvedRoots[0]}`,
    );
    return;
  }

  const roots = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => resolveConfiguredPath(entry));

  if (roots.length === 0) {
    resolvedRoots = [resolveConfiguredPath(os.homedir())];
    logger.warn("[BrowserRoots] All configured roots were invalid, falling back to home");
    return;
  }

  resolvedRoots = roots;
  logger.info(`[BrowserRoots] Configured roots: ${roots.join(", ")}`);
}

export function getBrowserRoots(): string[] {
  if (resolvedRoots === null) {
    initBrowserRoots(process.env.OPEN_BROWSER_ROOTS);
  }

  return resolvedRoots ?? [resolveConfiguredPath(os.homedir())];
}

export function isWithinAllowedRoot(targetPath: string): boolean {
  const normalizedTarget = normalizePath(targetPath);

  return getBrowserRoots().some((root) => {
    const normalizedRoot = normalizePath(root);

    return (
      normalizedTarget === normalizedRoot ||
      normalizedTarget.startsWith(`${normalizedRoot}/`) ||
      normalizedTarget.startsWith(`${normalizedRoot}\\`)
    );
  });
}

export async function isWithinAllowedRootSafe(targetPath: string): Promise<boolean> {
  let resolvedPath = targetPath;

  try {
    resolvedPath = await realpath(targetPath);
  } catch {
    // Keep the unresolved path when realpath fails.
  }

  return isWithinAllowedRoot(resolvedPath);
}

export function isAllowedRoot(targetPath: string): boolean {
  const normalizedTarget = normalizePath(targetPath);
  return getBrowserRoots().some((root) => normalizePath(root) === normalizedTarget);
}

export function __resetBrowserRootsForTests(): void {
  resolvedRoots = null;
}
