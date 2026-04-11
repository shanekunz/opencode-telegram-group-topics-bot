import { promises as fs } from "node:fs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_ENTRIES_PER_PAGE,
  buildEntryLabel,
  buildTreeHeader,
  getHomeDirectory,
  isScanError,
  pathToDisplayPath,
  scanDirectory,
} from "../../../src/bot/utils/file-tree.js";

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("bot/utils/file-tree", () => {
  describe("path helpers", () => {
    it("returns the OS home directory", () => {
      expect(getHomeDirectory()).toBe(os.homedir());
    });

    it("rewrites home-relative paths for display", () => {
      expect(pathToDisplayPath(os.homedir())).toBe("~");
      expect(pathToDisplayPath(path.join(os.homedir(), "projects", "app"))).toBe(
        `~${path.sep}projects${path.sep}app`,
      );
    });
  });

  describe("scanDirectory", () => {
    let tempDir = "";

    beforeEach(async () => {
      tempDir = await mkdtemp(path.join(os.tmpdir(), "file-tree-test-"));
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("lists visible subdirectories in alphabetical order", async () => {
      await mkdir(path.join(tempDir, "charlie"));
      await mkdir(path.join(tempDir, "alpha"));
      await mkdir(path.join(tempDir, "bravo"));
      await mkdir(path.join(tempDir, ".hidden"));
      await fs.writeFile(path.join(tempDir, "file.txt"), "content");

      const result = await scanDirectory(tempDir);

      expect(isScanError(result)).toBe(false);
      if (isScanError(result)) {
        return;
      }

      expect(result.entries.map((entry) => entry.name)).toEqual(["alpha", "bravo", "charlie"]);
      expect(result.totalCount).toBe(3);
      expect(result.hasParent).toBe(true);
      expect(result.parentPath).toBe(path.dirname(tempDir));
    });

    it("paginates and clamps page numbers", async () => {
      for (let index = 0; index < MAX_ENTRIES_PER_PAGE + 3; index++) {
        await mkdir(path.join(tempDir, `dir-${String(index).padStart(2, "0")}`));
      }

      const firstPage = await scanDirectory(tempDir, 0);
      const secondPage = await scanDirectory(tempDir, 1);
      const clampedPage = await scanDirectory(tempDir, 99);

      expect(isScanError(firstPage)).toBe(false);
      expect(isScanError(secondPage)).toBe(false);
      expect(isScanError(clampedPage)).toBe(false);

      if (isScanError(firstPage) || isScanError(secondPage) || isScanError(clampedPage)) {
        return;
      }

      expect(firstPage.entries).toHaveLength(MAX_ENTRIES_PER_PAGE);
      expect(secondPage.entries).toHaveLength(3);
      expect(secondPage.page).toBe(1);
      expect(clampedPage.page).toBe(1);
    });

    it("returns a structured error for missing directories", async () => {
      const result = await scanDirectory(path.join(tempDir, "missing"));

      expect(isScanError(result)).toBe(true);
      if (!isScanError(result)) {
        return;
      }

      expect(result.code).toBe("ENOENT");
    });
  });

  it("formats entry labels and tree headers", () => {
    expect(buildEntryLabel({ name: "repo", fullPath: "/tmp/repo" })).toBe("📁 repo");
    expect(buildTreeHeader("~/projects", 5, 1, 2)).toContain("(2/2)");
    expect(buildTreeHeader("~/empty", 0, 0, 1)).toContain("📭");
  });
});
