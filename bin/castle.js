#!/usr/bin/env -S node --import tsx

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
  .command("update")
  .description("Check for updates and install the latest version")
  .action(async () => {
    const { execSync } = await import("child_process");

    console.log(pc.bold("\n  🏰 Castle\n"));
    console.log(pc.dim("  Checking for updates...\n"));

    let latest;
    try {
      latest = execSync("npm view @castlekit/castle version", {
        encoding: "utf-8",
        timeout: 15000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      console.log(pc.yellow("  Could not check for updates. Try again later.\n"));
      return;
    }

    if (version === latest) {
      console.log(`  You're on the latest version (${pc.green(version)}).\n`);
      return;
    }

    // Check for major version bump
    const currentMajor = parseInt(version.split(".")[0], 10);
    const latestMajor = parseInt(latest.split(".")[0], 10);

    if (latestMajor > currentMajor) {
      const readline = await import("readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise((resolve) => {
        rl.question(
          `  ${pc.yellow("⚠")} Castle ${pc.cyan(latest)} is available (you have ${pc.dim(version)}).\n` +
          `  This is a major version update and may include breaking changes.\n\n` +
          `  Continue? (y/N) `,
          resolve
        );
      });
      rl.close();

      if (answer.toLowerCase() !== "y") {
        console.log(pc.dim("\n  Update cancelled.\n"));
        return;
      }
      console.log();
    }

    console.log(`  Updating Castle from ${pc.dim(version)} to ${pc.cyan(latest)}...\n`);

    try {
      execSync(`npm install -g @castlekit/castle@${latest}`, {
        stdio: "inherit",
        timeout: 120000,
      });
      console.log(pc.green(`\n  ✔ Updated successfully!\n`));
    } catch {
      console.log(pc.red(`\n  Update failed.`));
      console.log(`  Try manually: ${pc.cyan(`npm install -g @castlekit/castle@${latest}`)}\n`);
    }
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
      console.log(`  ${pc.cyan("castle open")}     Open the web UI`);
      console.log(`  ${pc.cyan("castle setup")}    Re-run setup wizard`);
      console.log(`  ${pc.cyan("castle status")}   Show status`);
      console.log(`  ${pc.cyan("castle update")}   Check for updates`);
      console.log(`  ${pc.cyan("castle --help")}   All commands\n`);
    }
  })();
} else {
  program.parse();
}
