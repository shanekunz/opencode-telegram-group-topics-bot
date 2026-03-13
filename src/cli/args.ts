import type { RuntimeMode } from "../runtime/mode.js";
import { t } from "../i18n/index.js";

export type CliCommand = "start" | "status" | "stop" | "config";

export interface ParsedCliArgs {
  command: CliCommand;
  mode?: RuntimeMode;
  showHelp: boolean;
  error?: string;
}

const SUPPORTED_COMMANDS: readonly CliCommand[] = ["start", "status", "stop", "config"];

function isCliCommand(value: string): value is CliCommand {
  return SUPPORTED_COMMANDS.includes(value as CliCommand);
}

function normalizeMode(value: string): RuntimeMode | null {
  if (value === "installed") {
    return "installed";
  }

  if (value === "sources") {
    return "sources";
  }

  return null;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const args = [...argv];
  let command: CliCommand = "start";
  let mode: RuntimeMode | undefined;
  let showHelp = false;
  let currentIndex = 0;

  const firstArg = args[0];
  if (firstArg && !firstArg.startsWith("-")) {
    if (!isCliCommand(firstArg)) {
      return {
        command,
        showHelp: true,
        error: t("cli.args.unknown_command", { value: firstArg }),
      };
    }

    command = firstArg;
    currentIndex = 1;
  }

  while (currentIndex < args.length) {
    const token = args[currentIndex];

    if (token === "--help" || token === "-h") {
      showHelp = true;
      currentIndex += 1;
      continue;
    }

    if (token === "--mode") {
      const modeValue = args[currentIndex + 1];
      if (!modeValue || modeValue.startsWith("-")) {
        return {
          command,
          mode,
          showHelp: true,
          error: t("cli.args.mode_requires_value"),
        };
      }

      const parsedMode = normalizeMode(modeValue);
      if (!parsedMode) {
        return {
          command,
          mode,
          showHelp: true,
          error: t("cli.args.invalid_mode", { value: modeValue }),
        };
      }

      mode = parsedMode;
      currentIndex += 2;
      continue;
    }

    if (token.startsWith("--mode=")) {
      const modeValue = token.slice("--mode=".length);
      const parsedMode = normalizeMode(modeValue);
      if (!parsedMode) {
        return {
          command,
          mode,
          showHelp: true,
          error: t("cli.args.invalid_mode", { value: modeValue }),
        };
      }

      mode = parsedMode;
      currentIndex += 1;
      continue;
    }

    return {
      command,
      mode,
      showHelp: true,
      error: t("cli.args.unknown_option", { value: token }),
    };
  }

  if (command !== "start" && command !== "config" && mode) {
    return {
      command,
      mode,
      showHelp: true,
      error: t("cli.args.mode_only_start"),
    };
  }

  return {
    command,
    mode,
    showHelp,
  };
}
