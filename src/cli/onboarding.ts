import * as p from "@clack/prompts";
import pc from "picocolors";
import { execSync } from "child_process";
import {
  isOpenClawInstalled,
  readOpenClawToken,
  ensureCastleDir,
  writeConfig,
  type CastleConfig,
} from "../lib/config.js";

const CASTLE_ASCII = `
  ${pc.bold(pc.blue("🏰 Castle"))}
`;

const TAGLINES = [
  "Your kingdom awaits, sire.",
  "The throne room is ready.",
  "A fortress for your AI agents.",
  "All hail the command center.",
  "Knights of the round terminal.",
  "Raise the drawbridge, lower the latency.",
  "By royal decree, your agents are assembled.",
  "The court is now in session.",
  "From castle walls to API calls.",
  "Forged in code, ruled by you.",
  "Every king needs a castle.",
  "Where agents serve and dragons compile.",
  "The siege of busywork ends here.",
  "Hear ye, hear ye — your agents await.",
  "A castle built on open source bedrock.",
];

function pickTagline(): string {
  return TAGLINES[Math.floor(Math.random() * TAGLINES.length)];
}

export async function runOnboarding(): Promise<void> {
  console.clear();
  console.log(CASTLE_ASCII);
  console.log(pc.dim(`  ${pickTagline()}\n`));

  p.intro(pc.inverse(" Castle Setup "));

  // Step 1: Check for OpenClaw
  const openclawSpinner = p.spinner();
  openclawSpinner.start("Checking for OpenClaw...");

  await new Promise((r) => setTimeout(r, 500));

  if (!isOpenClawInstalled()) {
    openclawSpinner.stop(pc.yellow("OpenClaw not found"));

    p.note(
      "Castle requires OpenClaw to run your AI agents.\nhttps://openclaw.ai",
      "OpenClaw Required"
    );

    const installChoice = await p.confirm({
      message: "Would you like us to install OpenClaw with default settings?",
    });

    if (p.isCancel(installChoice)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    if (installChoice) {
      const installSpinner = p.spinner();
      installSpinner.start("Installing OpenClaw...");

      try {
        execSync(
          'curl -fsSL --proto "=https" --tlsv1.2 https://openclaw.ai/install.sh | bash -s -- --no-onboard --no-prompt',
          { stdio: "pipe", timeout: 120000 }
        );
        installSpinner.stop(pc.green("OpenClaw installed"));
      } catch (error) {
        installSpinner.stop(pc.red("OpenClaw installation failed"));
        p.note(
          `Install OpenClaw manually:\n${pc.cyan(
            "curl -fsSL https://openclaw.ai/install.sh | bash"
          )}\n\nThen run: ${pc.cyan("castle setup")}`,
          "Manual Install"
        );
        p.outro("Come back when OpenClaw is installed!");
        process.exit(1);
      }
    } else {
      p.note(
        `Install OpenClaw:\n${pc.cyan(
          "curl -fsSL https://openclaw.ai/install.sh | bash"
        )}\n\nThen come back and run:\n${pc.cyan("castle setup")}`,
        "Install OpenClaw First"
      );
      p.outro("See you soon!");
      process.exit(0);
    }
  } else {
    openclawSpinner.stop(pc.green("OpenClaw detected"));
  }

  // Step 2: Gateway Connection
  const gatewayPort = await p.text({
    message: "OpenClaw Gateway port",
    placeholder: "18789",
    defaultValue: "18789",
    validate(value: string | undefined) {
      const num = parseInt(value || "0", 10);
      if (isNaN(num) || num < 1 || num > 65535) {
        return "Please enter a valid port number (1-65535)";
      }
    },
  });

  if (p.isCancel(gatewayPort)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const port = parseInt(gatewayPort as string, 10);

  // Step 3: Token detection
  const tokenSpinner = p.spinner();
  tokenSpinner.start("Looking for OpenClaw auth token...");

  await new Promise((r) => setTimeout(r, 300));

  let token = readOpenClawToken();

  if (token) {
    tokenSpinner.stop(pc.green("Auth token found in OpenClaw config"));
  } else {
    tokenSpinner.stop(pc.yellow("No auth token found"));

    const tokenInput = await p.text({
      message: "Enter your OpenClaw Gateway token (or press Enter to skip)",
      placeholder: "Leave empty if no auth is configured",
      defaultValue: "",
    });

    if (p.isCancel(tokenInput)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    token = (tokenInput as string) || null;
  }

  // Step 4: Agent Discovery (placeholder - will use real WebSocket later)
  const agentSpinner = p.spinner();
  agentSpinner.start("Discovering agents...");

  await new Promise((r) => setTimeout(r, 800));

  // For now, we'll note that agent discovery requires the Gateway to be running
  // This will be replaced with actual WebSocket discovery
  agentSpinner.stop(pc.dim("Agent discovery will connect when Gateway is running"));

  let primaryAgent: string | undefined;

  const setPrimary = await p.text({
    message: "Name of your primary agent (the main agent Castle talks to)",
    placeholder: "assistant",
    defaultValue: "assistant",
  });

  if (p.isCancel(setPrimary)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  primaryAgent = setPrimary as string;

  // Step 5: Create Castle config
  const setupSpinner = p.spinner();
  setupSpinner.start("Setting up Castle...");

  ensureCastleDir();

  const config: CastleConfig = {
    openclaw: {
      gateway_port: port,
      gateway_token: token || undefined,
      primary_agent: primaryAgent,
    },
    server: {
      port: 3333,
    },
  };

  writeConfig(config);

  await new Promise((r) => setTimeout(r, 300));
  setupSpinner.stop(pc.green("Castle configured"));

  p.note(
    `Data directory: ${pc.cyan("~/.castle/")}\nConfig: ${pc.cyan(
      "~/.castle/castle.json"
    )}\nWeb UI: ${pc.cyan("http://localhost:3333")}\nPrimary agent: ${pc.cyan(
      primaryAgent
    )}`,
    "Configuration"
  );

  // Step 6: Enter the Castle
  const enterCastle = await p.confirm({
    message: "Are you ready to enter the castle?",
    active: "Yes, let's go!",
    inactive: "Yes, let's go!",
  });

  if (p.isCancel(enterCastle)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  p.outro(pc.bold("🏰 Welcome to Castle!"));

  console.log(
    `\n  ${pc.dim("Starting Castle at")} ${pc.cyan("http://localhost:3333")}\n`
  );

  // Launch the web UI
  const open = (await import("open")).default;
  await open("http://localhost:3333");
}
