import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../../src/cli/args.js";

describe("cli/args", () => {
  it("uses start command by default", () => {
    const parsed = parseCliArgs([]);

    expect(parsed).toEqual({
      command: "start",
      mode: undefined,
      showHelp: false,
    });
  });

  it("parses explicit start command and installed mode", () => {
    const parsed = parseCliArgs(["start", "--mode", "installed"]);

    expect(parsed).toEqual({
      command: "start",
      mode: "installed",
      showHelp: false,
    });
  });

  it("parses explicit sources mode", () => {
    const parsed = parseCliArgs(["start", "--mode", "sources"]);

    expect(parsed).toEqual({
      command: "start",
      mode: "sources",
      showHelp: false,
    });
  });

  it("rejects unknown mode as invalid", () => {
    const parsed = parseCliArgs(["start", "--mode=invalid"]);

    expect(parsed.command).toBe("start");
    expect(parsed.showHelp).toBe(true);
    expect(parsed.error).toContain("Invalid mode value");
  });

  it("shows help for unknown command", () => {
    const parsed = parseCliArgs(["deploy"]);

    expect(parsed.command).toBe("start");
    expect(parsed.showHelp).toBe(true);
    expect(parsed.error).toContain("Unknown command");
  });

  it("shows help for invalid mode", () => {
    const parsed = parseCliArgs(["start", "--mode", "qa"]);

    expect(parsed.command).toBe("start");
    expect(parsed.showHelp).toBe(true);
    expect(parsed.error).toContain("Invalid mode value");
  });

  it("allows --mode for config command", () => {
    const parsed = parseCliArgs(["config", "--mode", "sources"]);

    expect(parsed).toEqual({
      command: "config",
      mode: "sources",
      showHelp: false,
    });
  });

  it("rejects --mode for commands other than start/config", () => {
    const parsed = parseCliArgs(["status", "--mode", "sources"]);

    expect(parsed.command).toBe("status");
    expect(parsed.showHelp).toBe(true);
    expect(parsed.error).toContain("supported only for the start and config commands");
  });

  it("shows help when requested", () => {
    const parsed = parseCliArgs(["--help"]);

    expect(parsed).toEqual({
      command: "start",
      mode: undefined,
      showHelp: true,
    });
  });
});
