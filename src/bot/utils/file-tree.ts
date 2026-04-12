import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { t } from "../../i18n/index.js";

export interface DirectoryEntry {
  name: string;
  fullPath: string;
}

export interface DirectoryScanResult {
  entries: DirectoryEntry[];
  totalCount: number;
  page: number;
  currentPath: string;
  displayPath: string;
  hasParent: boolean;
  parentPath: string | null;
}

export interface DirectoryScanError {
  error: string;
  code: "ENOENT" | "EACCES" | "ENOTDIR" | "UNKNOWN";
}

export const MAX_ENTRIES_PER_PAGE = 8;

function getHomeDirectory(): string {
  return os.homedir();
}

export function pathToDisplayPath(absolutePath: string): string {
  const home = getHomeDirectory();
  if (absolutePath === home) {
    return "~";
  }

  if (absolutePath.startsWith(home + path.sep)) {
    return `~${absolutePath.slice(home.length)}`;
  }

  return absolutePath;
}

export async function scanDirectory(
  dirPath: string,
  page: number = 0,
): Promise<DirectoryScanResult | DirectoryScanError> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const subdirs: DirectoryEntry[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        subdirs.push({
          name: entry.name,
          fullPath: path.join(dirPath, entry.name),
        });
      }
    }

    subdirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    const totalPages = Math.max(1, Math.ceil(subdirs.length / MAX_ENTRIES_PER_PAGE));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const start = safePage * MAX_ENTRIES_PER_PAGE;
    const hasParent = dirPath !== path.parse(dirPath).root;

    return {
      entries: subdirs.slice(start, start + MAX_ENTRIES_PER_PAGE),
      totalCount: subdirs.length,
      page: safePage,
      currentPath: dirPath,
      displayPath: pathToDisplayPath(dirPath),
      hasParent,
      parentPath: hasParent ? path.dirname(dirPath) : null,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      const code = error.code as string;

      if (code === "ENOENT" || code === "ELOOP") {
        return { error: `Directory not found: ${dirPath}`, code: "ENOENT" };
      }

      if (code === "EACCES" || code === "EPERM") {
        return { error: `Permission denied: ${dirPath}`, code: "EACCES" };
      }

      if (code === "ENOTDIR") {
        return { error: `Not a directory: ${dirPath}`, code: "ENOTDIR" };
      }
    }

    return {
      error: error instanceof Error ? error.message : "Unknown error",
      code: "UNKNOWN",
    };
  }
}

export function buildEntryLabel(entry: DirectoryEntry): string {
  return `📁 ${entry.name}`;
}

export function buildTreeHeader(
  displayPath: string,
  totalCount: number,
  page: number,
  totalPages: number,
): string {
  let header = `📂 ${displayPath}`;

  if (totalPages > 1) {
    header += `  (${page + 1}/${totalPages})`;
  }

  if (totalCount === 0) {
    return `${header}\n${t("open.no_subfolders")}`;
  }

  return `${header}\n${
    totalCount === 1
      ? t("open.subfolder_count", { count: String(totalCount) })
      : t("open.subfolders_count", { count: String(totalCount) })
  }`;
}

export function isScanError(
  result: DirectoryScanResult | DirectoryScanError,
): result is DirectoryScanError {
  return "error" in result;
}
