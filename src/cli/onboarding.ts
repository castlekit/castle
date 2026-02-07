import * as p from "@clack/prompts";
import pc from "picocolors";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import WebSocket from "ws";
import {
  isOpenClawInstalled,
  readOpenClawToken,
  readOpenClawPort,
  ensureCastleDir,
  writeConfig,
  type CastleConfig,
} from "../lib/config.js";

// Castle blue helpers using standard ANSI colors (universal terminal support)
const BLUE = (s: string) => `\x1b[94m${s}\x1b[0m`;        // bright blue
const BLUE_LIGHT = (s: string) => `\x1b[96m${s}\x1b[0m`;  // bright cyan (lighter blue)
const BLUE_BOLD = (s: string) => `\x1b[1m\x1b[94m${s}\x1b[0m`; // bold bright blue
const BLUE_DIM = (s: string) => `\x1b[34m${s}\x1b[0m`;    // standard blue (muted)

// Patch picocolors so @clack/prompts UI chrome (bars, dots, highlights) uses Castle blue
// @clack/prompts imports picocolors as an object reference, so overriding methods here
// changes the colors of all internal rendering (│ bars, ◆ dots, highlights, etc.)
const _pc = pc as Record<string, unknown>;
_pc.gray = BLUE_DIM;
_pc.green = BLUE;
_pc.greenBright = BLUE;
_pc.cyan = BLUE;
_pc.cyanBright = BLUE;
_pc.blue = BLUE;
_pc.blueBright = BLUE;
_pc.magenta = BLUE;
_pc.magentaBright = BLUE;
_pc.yellow = BLUE_DIM;
_pc.yellowBright = BLUE_DIM;
// red stays red for errors — no override

interface DiscoveredAgent {
  id: string;
  name: string;
  description: string | null;
}

/**
 * Connect to Gateway and discover agents via agents.list.
 * Returns the list of agents or an empty array on failure.
 */
async function discoverAgents(port: number, token: string | null): Promise<DiscoveredAgent[]> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      resolve([]);
    }, 8000);

    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://127.0.0.1:${port}`);
    } catch {
      clearTimeout(timeout);
      resolve([]);
      return;
    }

    ws.on("error", () => {
      clearTimeout(timeout);
      resolve([]);
    });

    ws.on("open", () => {
      // Send connect handshake
      const connectId = randomUUID();
      const connectFrame = {
        type: "req",
        id: connectId,
        method: "connect",
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: "gateway-client",
            displayName: "Castle CLI",
            version: "0.0.1",
            platform: process.platform,
            mode: "backend",
          },
          auth: token ? { token } : undefined,
          role: "operator",
          scopes: ["operator.admin"],
          caps: [],
        },
      };
      ws.send(JSON.stringify(connectFrame));

      // Wait for connect response, then request agents
      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());

          // Connect response
          if (msg.type === "res" && msg.id === connectId) {
            if (!msg.ok) {
              clearTimeout(timeout);
              ws.close();
              resolve([]);
              return;
            }
            // Connected -- now request agents
            const agentsId = randomUUID();
            const agentsFrame = {
              type: "req",
              id: agentsId,
              method: "agents.list",
              params: {},
            };
            ws.send(JSON.stringify(agentsFrame));
          }

          // Agents response (any successful res that isn't the connect response)
          if (msg.type === "res" && msg.id !== connectId && msg.ok) {
            clearTimeout(timeout);
            ws.close();
            const payload = msg.payload || {};
            const agents = (payload.agents || []).map((a: { id: string; name?: string; identity?: { name?: string; theme?: string } }) => ({
              id: a.id,
              name: a.identity?.name || a.name || a.id,
              description: a.identity?.theme || null,
            }));
            resolve(agents);
          }
        } catch {
          // ignore parse errors
        }
      });
    });
  });
}

const CASTLE_LINES = [
  "                                  |>>>",
  "                                  |",
  "                    |>>>      _  _|_  _         |>>>",
  "                    |        |;| |;| |;|        |",
  "                _  _|_  _    \\.    .  /    _  _|_  _",
  "               |;|_|;|_|;|    \\:. ,  /    |;|_|;|_|;|",
  "               \\..      /    ||;   . |    \\.    .  /",
  "                \\.  ,  /     ||:  .  |     \\:  .  /",
  "                 ||:   |_   _ ||_ . _ | _   _||:   |",
  "                 ||:  .|||_|;|_|;|_|;|_|;|_|;||:.  |",
  "                 ||:   ||.    .     .      . ||:  .|",
  "                 ||: . || .     . .   .  ,   ||:   |       \\,/",
  "                 ||:   ||:  ,  _______   .   ||: , |            /`\\",
  "                 ||:   || .   /+++++++\\    . ||:   |",
  "                 ||:   ||.    |+++++++| .    ||: . |",
  "              __ ||: . ||: ,  |+++++++|.  . _||_   |",
  "     ____--`~    '--~~__|.    |+++++__|----~    ~`---,              ___",
  "-~--~                   ~---__|,--~'                  ~~----_____-~'   `~----~~",
];

/**
 * Apply a blue-to-purple gradient across the castle banner lines.
 * Uses ANSI 256-color codes to smoothly transition from bright blue to magenta.
 */
function gradientBanner(): string {
  // ANSI 256 colour codes: blue → purple gradient
  // 39=blue, 38=blue, 33=darkblue, 63=slateblue, 99=purple, 135=magenta, 141=violet, 177=orchid
  const gradient = [27, 27, 33, 33, 63, 63, 99, 99, 135, 135, 141, 141, 177, 177, 177, 176, 176, 176];

  return CASTLE_LINES.map((line, i) => {
    const colorCode = gradient[Math.min(i, gradient.length - 1)];
    return `\x1b[38;5;${colorCode}m${line}\x1b[0m`;
  }).join("\n");
}

const CASTLE_ASCII = `
${gradientBanner()}

  ${BLUE_BOLD("Castle")} ${pc.dim("— The multi-agent workspace")}
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

  p.intro(BLUE_BOLD("Castle Setup"));

  p.note(
    [
      "Castle is your multi-agent workspace — a local-first",
      "interface for managing and interacting with your",
      "OpenClaw AI agents.",
      "",
      `${pc.dim("Learn more:")} ${BLUE_LIGHT("https://castlekit.com")}`,
    ].join("\n"),
    "Welcome"
  );

  const ready = await p.confirm({
    message: "Ready to set up Castle?",
  });

  if (p.isCancel(ready) || !ready) {
    p.cancel("No worries — run castle setup when you're ready.");
    process.exit(0);
  }

  // Step 1: Check for OpenClaw
  const openclawSpinner = p.spinner();
  openclawSpinner.start("Checking for OpenClaw...");

  await new Promise((r) => setTimeout(r, 500));

  if (!isOpenClawInstalled()) {
    openclawSpinner.stop(pc.dim("OpenClaw not found"));

    p.note(
      `Castle requires OpenClaw to run your AI agents.\n${BLUE_LIGHT("https://openclaw.ai")}`,
      BLUE_BOLD("OpenClaw Required")
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
        installSpinner.stop(BLUE("✔ OpenClaw installed"));
      } catch (error) {
        installSpinner.stop(pc.red("OpenClaw installation failed"));
        p.note(
          `Install OpenClaw manually:\n${BLUE_LIGHT(
            "curl -fsSL https://openclaw.ai/install.sh | bash"
          )}\n\nThen run: ${BLUE_LIGHT("castle setup")}`,
          BLUE_BOLD("Manual Install")
        );
        p.outro("Come back when OpenClaw is installed!");
        process.exit(1);
      }
    } else {
      p.note(
        `Install OpenClaw:\n${BLUE_LIGHT(
          "curl -fsSL https://openclaw.ai/install.sh | bash"
        )}\n\nThen come back and run:\n${BLUE_LIGHT("castle setup")}`,
        BLUE_BOLD("Install OpenClaw First")
      );
      p.outro("See you soon!");
      process.exit(0);
    }
  } else {
    // Auto-detect token and agents in one go
    const token = readOpenClawToken();
    const agents = await discoverAgents(18789, token);

    openclawSpinner.stop(`\x1b[92m✔\x1b[0m OpenClaw detected`);

    if (agents.length > 0 && token) {
      p.log.message(
        [
          `${pc.dim("—")} ${pc.dim(`Gateway running on port ${18789}`)}`,
          `${pc.dim("—")} ${pc.dim("Auth token found")}`,
          `${pc.dim("—")} ${pc.dim(`${agents.length} agent${agents.length !== 1 ? "s" : ""} discovered: ${agents.map((a) => a.name).join(", ")}`)}`,
        ].join("\n")
      );
    } else if (token) {
      p.log.message(
        [
          `${pc.dim("—")} ${pc.dim("Auth token found")}`,
          `${pc.dim("—")} ${pc.dim("Could not reach Gateway — agents will be discovered when it's running")}`,
        ].join("\n")
      );
    }
  }

  // Step 2: Auto-detect port and token, only ask if not found
  let port = readOpenClawPort() || 18789;
  let token = readOpenClawToken();

  if (!readOpenClawPort()) {
    const gatewayPort = await p.text({
      message: "OpenClaw Gateway port",
      initialValue: "18789",
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

    port = parseInt(gatewayPort as string, 10);
  }

  if (!token) {
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

  // Step 4: Agent Discovery
  const agents = await discoverAgents(port, token);

  let primaryAgent: string;

  if (agents.length > 0) {

    const selectedAgent = await p.select({
      message: "Choose your primary agent",
      options: agents.map((a) => ({
        value: a.id,
        label: `${a.name} ${pc.dim(`<${a.id}>`)}`,
        hint: a.description || undefined,
      })),
    });

    if (p.isCancel(selectedAgent)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    primaryAgent = selectedAgent as string;
  } else {
    const setPrimary = await p.text({
      message: "Enter the name of your primary agent",
      initialValue: "assistant",
      validate(value: string | undefined) {
        if (!value?.trim()) return "Agent name is required";
      },
    });

    if (p.isCancel(setPrimary)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    primaryAgent = setPrimary as string;
  }

  // Step 5: Create Castle config
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

  // Step 6: Start server before showing summary
  const serverSpinner = p.spinner();
  serverSpinner.start("Starting Castle...");

  const { spawn } = await import("child_process");
  const { resolve, dirname } = await import("path");
  const { fileURLToPath } = await import("url");

  // Resolve to the castle project root (src/cli/onboarding.ts -> ../../ -> project root)
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

  const server = spawn("npm", ["run", "dev"], {
    cwd: projectRoot,
    stdio: "ignore",
    detached: true,
  });
  server.unref();

  // Wait for server to be ready
  const maxWait = 30000;
  const startTime = Date.now();
  let serverReady = false;

  while (Date.now() - startTime < maxWait) {
    try {
      const res = await fetch("http://localhost:3333");
      if (res.ok || res.status === 404) {
        serverReady = true;
        break;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!serverReady) {
    serverSpinner.stop(pc.red("Server took too long to start"));
    p.outro(pc.dim(`Try running ${BLUE("npm run dev")} manually, then ${BLUE("castle open")}`));
    return;
  }

  serverSpinner.stop(`\x1b[92m✔\x1b[0m Castle is running`);

  // Find the display name for the selected primary agent
  const primaryDisplay = agents.find((a) => a.id === primaryAgent)?.name || primaryAgent;

  p.note(
    [
      "",
      `  ${BLUE_BOLD("🏰 Welcome to Castle!")}`,
      "",
      `  ${pc.dim("Data directory")}  ${BLUE_LIGHT("~/.castle/")}`,
      `  ${pc.dim("Config")}          ${BLUE_LIGHT("~/.castle/castle.json")}`,
      `  ${pc.dim("Primary agent")}   ${BLUE_BOLD(primaryDisplay)}`,
      "",
      `  ${BLUE_BOLD("➜")}  \x1b[1m\x1b[4m\x1b[94mhttp://localhost:3333\x1b[0m`,
      "",
      `  ${pc.dim("Your agents are ready. Let's go!")} 🚀`,
      "",
    ].join("\n"),
    BLUE_BOLD("✨ Setup Complete")
  );

  const openBrowser = await p.confirm({
    message: "Want to open Castle in your browser?",
  });

  if (p.isCancel(openBrowser) || !openBrowser) {
    p.outro(pc.dim(`Run ${BLUE("castle")} anytime to launch Castle.`));
    return;
  }

  p.outro(pc.dim(`Opening ${BLUE("http://localhost:3333")}...`));
  const open = (await import("open")).default;
  await open("http://localhost:3333");
}
