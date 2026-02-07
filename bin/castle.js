#!/usr/bin/env -S npx --yes tsx

// Castle CLI - The multi-agent workspace
// https://castlekit.com

import { program } from "commander";
import pc from "picocolors";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
let version = "0.0.0";
try {
  version = JSON.parse(readFileSync(resolve(__dirname, "..", "package.json"), "utf-8")).version;
} catch { /* fallback */ }

program
  .name("castle")
  .description("The multi-agent workspace")
  .version(version);

program
  .command("setup")
  .description("Run the Castle setup wizard")
  .action(async () => {
    const { runOnboarding } = await import("../src/cli/onboarding.ts");
    await runOnboarding();
  });

program
  .command("open")
  .description("Open Castle in the browser")
  .action(async () => {
    const { readConfig, configExists } = await import("../src/lib/config.ts");
    const open = (await import("open")).default;
    const port = configExists() ? readConfig().server?.port || 3333 : 3333;
    const url = `http://localhost:${port}`;
    console.log(pc.bold("\n  🏰 Castle\n"));
    console.log(`  Opening ${pc.cyan(url)}...\n`);
    await open(url);
  });

program
  .command("status")
  .description("Show Castle and agent status")
  .action(async () => {
    const { readConfig, configExists, isOpenClawInstalled } = await import(
      "../src/lib/config.ts"
    );

    console.log(pc.bold("\n  🏰 Castle Status\n"));

    if (!configExists()) {
      console.log(pc.yellow("  Castle is not configured yet."));
      console.log(`  Run ${pc.cyan("castle setup")} to get started.\n`);
      return;
    }

    const config = readConfig();
    console.log(
      `  OpenClaw: ${
        isOpenClawInstalled() ? pc.green("Installed") : pc.red("Not found")
      }`
    );
    console.log(`  Gateway:  ${pc.dim(`ws://127.0.0.1:${config.openclaw.gateway_port}`)}`);
    console.log(
      `  Primary:  ${pc.cyan(config.openclaw.primary_agent || "not set")}`
    );
    console.log(`  Web UI:   ${pc.cyan(`http://localhost:${config.server.port}`)}`);
    console.log();
  });

// Default action (no subcommand) — trigger setup if first run, otherwise show help
if (process.argv.length <= 2) {
  (async () => {
    const { configExists } = await import("../src/lib/config.ts");

    if (!configExists()) {
      // First run — trigger onboarding
      const { runOnboarding } = await import("../src/cli/onboarding.ts");
      await runOnboarding();
    } else {
      console.log(pc.bold("\n  🏰 Castle\n"));
      console.log(pc.dim("  The multi-agent workspace.\n"));
      console.log(`  ${pc.cyan("castle open")}    Open the web UI`);
      console.log(`  ${pc.cyan("castle setup")}   Re-run setup wizard`);
      console.log(`  ${pc.cyan("castle status")}  Show status`);
      console.log(`  ${pc.cyan("castle --help")}  All commands\n`);
    }
  })();
} else {
  program.parse();
}
