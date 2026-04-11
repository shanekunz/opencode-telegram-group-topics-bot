import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  __resetBrowserRootsForTests,
  getBrowserRoots,
  initBrowserRoots,
  isAllowedRoot,
  isWithinAllowedRoot,
} from "../../../src/bot/utils/browser-roots.js";

describe("bot/utils/browser-roots", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    __resetBrowserRootsForTests();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    delete process.env.OPEN_BROWSER_ROOTS;
    __resetBrowserRootsForTests();
  });

  it("defaults to the home directory", () => {
    initBrowserRoots(undefined);
    expect(getBrowserRoots()).toEqual([path.resolve(os.homedir())]);
  });

  it("parses comma-separated roots and trims whitespace", () => {
    initBrowserRoots(" ~/projects , /opt/repos ");

    expect(getBrowserRoots()).toEqual([
      path.resolve(path.join(os.homedir(), "projects")),
      path.resolve("/opt/repos"),
    ]);
  });

  it("lazily initializes from OPEN_BROWSER_ROOTS", () => {
    process.env.OPEN_BROWSER_ROOTS = "/tmp/test-root";

    expect(getBrowserRoots()).toEqual([path.resolve("/tmp/test-root")]);
  });

  it("allows exact roots and descendants", () => {
    initBrowserRoots("/home/user/projects,/opt/repos");

    expect(isWithinAllowedRoot("/home/user/projects")).toBe(true);
    expect(isWithinAllowedRoot("/home/user/projects/app")).toBe(true);
    expect(isWithinAllowedRoot("/opt/repos/lib")).toBe(true);
    expect(isWithinAllowedRoot("/etc/passwd")).toBe(false);
    expect(isWithinAllowedRoot("/home/user/projects-backup")).toBe(false);
  });

  it("matches case-insensitively on Windows", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    __resetBrowserRootsForTests();
    initBrowserRoots("/home/User/Projects");

    expect(isWithinAllowedRoot("/home/user/projects/app")).toBe(true);
    expect(isAllowedRoot("/HOME/USER/PROJECTS")).toBe(true);
  });

  it("only treats exact matches as allowed roots", () => {
    initBrowserRoots("/home/user/projects");

    expect(isAllowedRoot("/home/user/projects")).toBe(true);
    expect(isAllowedRoot("/home/user/projects/child")).toBe(false);
  });
});
