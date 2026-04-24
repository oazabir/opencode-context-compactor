#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { createInterface } from "readline";

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

const ask = (q: string): Promise<string> =>
  new Promise((resolve) => rl.question(q, resolve));

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

interface OpenCodeConfig {
  plugin?: [string, Record<string, unknown>][];
  [key: string]: unknown;
}

const CONFIG_PATHS = [
  join(homedir(), ".config", "opencode", "config.json"),
  join(homedir(), ".opencode", "config.json"),
];

function findConfigPath(): string | undefined {
  return CONFIG_PATHS.find((p) => existsSync(p));
}

function readConfig(path: string): OpenCodeConfig {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as OpenCodeConfig;
  } catch {
    return {};
  }
}

function writeConfig(path: string, config: OpenCodeConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

function isPluginInstalled(config: OpenCodeConfig): boolean {
  if (!Array.isArray(config.plugin)) return false;
  return config.plugin.some(
    (entry) => Array.isArray(entry) && entry[0] === "opencode-context-compactor"
  );
}

async function main() {
  console.log(cyan("\n  OpenCode Context Compactor Installer\n"));
  console.log(dim("  Automatically compacts conversation context.\n"));

  let configPath = findConfigPath();

  if (!configPath) {
    console.log(yellow("  No OpenCode config found."));
    console.log("  Creating one at: " + dim(CONFIG_PATHS[0]));
    configPath = CONFIG_PATHS[0];
  }

  if (!configPath) {
    console.error(red("  Could not determine config path.\n"));
    rl.close();
    process.exit(1);
  }

  const config = readConfig(configPath);

  if (isPluginInstalled(config)) {
    console.log(green("  Plugin is already installed in your OpenCode config."));
    console.log(dim("  Config: " + configPath + "\n"));
    rl.close();
    return;
  }

  console.log("  Config file: " + dim(configPath) + "\n");

  // Default options
  const options: Record<string, unknown> = {
    keep_messages: 10,
    mode: "hybrid",
    token_threshold: 2000,
  };

  const useDefaults = process.argv.includes("--yes") || process.argv.includes("-y");

  if (!useDefaults) {
    const answer = await ask(
      cyan("  Use default settings? (keep_messages=10, mode=hybrid) [Y/n]: ")
    );
    if (answer.trim().toLowerCase() === "n") {
      const keep = await ask("  keep_messages (default 10): ");
      if (keep.trim()) {
        const n = parseInt(keep, 10);
        if (!isNaN(n)) options.keep_messages = n;
      }

      const mode = await ask("  mode (concatenate/summarize/hybrid, default hybrid): ");
      if (["concatenate", "summarize", "hybrid"].includes(mode.trim())) {
        options.mode = mode.trim();
      }

      const threshold = await ask("  token_threshold (default 2000): ");
      if (threshold.trim()) {
        const n = parseInt(threshold, 10);
        if (!isNaN(n)) options.token_threshold = n;
      }
    }
  }

  // Add plugin entry
  if (!Array.isArray(config.plugin)) {
    config.plugin = [];
  }
  config.plugin.push(["opencode-context-compactor", options]);

  writeConfig(configPath, config);

  console.log(green("\n  Plugin installed successfully!"));
  console.log("  Config updated: " + dim(configPath));
  console.log("\n  Installed with options:");
  for (const [key, value] of Object.entries(options)) {
    console.log(`    ${key}: ${cyan(String(value))}`);
  }
  console.log("\n  Restart OpenCode to activate the plugin.\n");

  rl.close();
}

main().catch((err) => {
  console.error(red("\n  Error: " + (err instanceof Error ? err.message : String(err)) + "\n"));
  process.exit(1);
});
