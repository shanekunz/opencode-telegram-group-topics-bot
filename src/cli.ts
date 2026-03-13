#!/usr/bin/env node

import type { RuntimeMode } from "./runtime/mode.js";
import { parseCliArgs, type CliCommand } from "./cli/args.js";
import { resolveRuntimeMode, setRuntimeMode } from "./runtime/mode.js";
import { t } from "./i18n/index.js";

const EXIT_SUCCESS = 0;
const EXIT_RUNTIME_ERROR = 1;
const EXIT_INVALID_ARGS = 2;

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

function printUsage(): void {
  writeStdout(t("cli.usage"));
}

function getPlaceholderMessage(command: Exclude<CliCommand, "start">): string {
  if (command === "status") {
    return t("cli.placeholder.status");
  }

  if (command === "stop") {
    return t("cli.placeholder.stop");
  }

  return t("cli.placeholder.unavailable");
}

async function runStartCommand(mode?: RuntimeMode): Promise<number> {
  const modeResult = resolveRuntimeMode({
    defaultMode: "installed",
    explicitMode: mode,
  });

  if (modeResult.error) {
    throw new Error(modeResult.error);
  }

  setRuntimeMode(modeResult.mode);

  const { ensureRuntimeConfigForStart } = await import("./runtime/bootstrap.js");
  await ensureRuntimeConfigForStart();

  const { startBotApp } = await import("./app/start-bot-app.js");
  await startBotApp();
  return EXIT_SUCCESS;
}

async function runConfigCommand(mode?: RuntimeMode): Promise<number> {
  setRuntimeMode(mode ?? "installed");

  const { runConfigWizardCommand } = await import("./runtime/bootstrap.js");
  await runConfigWizardCommand();
  return EXIT_SUCCESS;
}

async function runPlaceholderCommand(
  command: Exclude<CliCommand, "start" | "config">,
): Promise<number> {
  writeStdout(getPlaceholderMessage(command));
  return EXIT_SUCCESS;
}

async function runCli(argv: string[]): Promise<number> {
  const parsedArgs = parseCliArgs(argv);

  if (parsedArgs.error) {
    writeStderr(parsedArgs.error);
  }

  if (parsedArgs.showHelp) {
    printUsage();
    return parsedArgs.error ? EXIT_INVALID_ARGS : EXIT_SUCCESS;
  }

  if (parsedArgs.command === "start") {
    return runStartCommand(parsedArgs.mode);
  }

  if (parsedArgs.command === "config") {
    return runConfigCommand(parsedArgs.mode);
  }

  return runPlaceholderCommand(parsedArgs.command);
}

void runCli(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    if (error instanceof Error) {
      writeStderr(t("cli.error.prefix", { message: error.message }));
    } else {
      writeStderr(t("cli.error.prefix", { message: String(error) }));
    }

    process.exitCode = EXIT_RUNTIME_ERROR;
  });
