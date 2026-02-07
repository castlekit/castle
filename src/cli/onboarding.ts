import * as p from "@clack/prompts";
import pc from "picocolors";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import WebSocket from "ws";
import { readFileSync } from "fs";
import { resolve as resolvePath, dirname } from "path";
import { fileURLToPath } from "url";
import {
  isOpenClawInstalled,
  readOpenClawToken,
  readOpenClawPort,
  ensureCastleDir,
  writeConfig,
  type CastleConfig,
} from "../lib/config.js";
// Device identity is handled by gateway-connection.ts for the persistent connection.
// The onboarding wizard uses simple token-only auth for agent discovery.

// Read version from package.json at the project root
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolvePath(__dirname, "..", "..");
let PKG_VERSION = "0.0.0";
try {
  PKG_VERSION = JSON.parse(readFileSync(resolvePath(PROJECT_ROOT, "package.json"), "utf-8")).version;
} catch {
  // Fallback if package.json is missing or invalid
}

// Castle blue helpers using standard ANSI colors (universal terminal support)
const BLUE = (s: string) => `\x1b[94m${s}\x1b[0m`;        // bright blue
const BLUE_LIGHT = (s: string) => `\x1b[96m${s}\x1b[0m`;  // bright cyan (lighter blue)
const BLUE_BOLD = (s: string) => `\x1b[1m\x1b[94m${s}\x1b[0m`; // bold bright blue
const BLUE_DIM = (s: string) => `\x1b[34m${s}\x1b[0m`;    // standard blue (muted)

// Patch picocolors so @clack/prompts UI chrome (bars, dots, highlights) uses Castle blue
// @clack/prompts imports picocolors as an object reference, so overriding methods here
// changes the colors of all internal rendering (│ bars, ◆ dots, highlights, etc.)
const _pc = pc as unknown as Record<string, unknown>;
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
 * Supports both port-based (local) and full URL (remote) connections.
 * Returns the list of agents or an empty array on failure.
 */
async function discoverAgents(
  portOrUrl: number | string,
  token: string | null
): Promise<DiscoveredAgent[]> {
  const wsUrl = typeof portOrUrl === "string" ? portOrUrl : `ws://127.0.0.1:${portOrUrl}`;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      resolve([]);
    }, 8000);

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
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
      // NOTE: No device identity here — discoverAgents is just for listing agents
      // during setup. Device auth happens in gateway-connection.ts for the real connection.
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
            version: PKG_VERSION,
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
            const agentsList = Array.isArray(payload.agents) ? payload.agents : [];
            const agents = agentsList.map((a: { id: string; name?: string; identity?: { name?: string; theme?: string } }) => ({
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

/**
 * Test a Gateway connection. Returns true if connection succeeds.
 */
async function testConnection(
  portOrUrl: number | string,
  token: string | null
): Promise<boolean> {
  const wsUrl = typeof portOrUrl === "string" ? portOrUrl : `ws://127.0.0.1:${portOrUrl}`;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      resolve(false);
    }, 5000);

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      clearTimeout(timeout);
      resolve(false);
      return;
    }

    ws.on("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });

    ws.on("open", () => {
      clearTimeout(timeout);
      ws.close();
      resolve(true);
    });
  });
}

/**
 * Prompt for manual Gateway configuration (remote or local).
 * Returns connection details or null if cancelled.
 */
async function promptManualGateway(): Promise<{
  port: number;
  token: string | null;
  gatewayUrl?: string;
  isRemote: boolean;
} | null> {
  const locationType = await p.select({
    message: "Where is your OpenClaw Gateway?",
    options: [
      {
        value: "local",
        label: "Local machine",
        hint: "Running on this device (127.0.0.1)",
      },
      {
        value: "remote",
        label: "Remote / Tailscale",
        hint: "Running on another machine",
      },
    ],
  });

  if (p.isCancel(locationType)) return null;

  let port = 18789;
  let gatewayUrl: string | undefined;
  const isRemote = locationType === "remote";

  if (isRemote) {
    const urlInput = await p.text({
      message: "Gateway WebSocket URL",
      placeholder: "ws://192.168.1.50:18789",
      validate(value: string | undefined) {
        if (!value?.trim()) return "URL is required";
        if (!value.startsWith("ws://") && !value.startsWith("wss://")) {
          return "URL must start with ws:// or wss://";
        }
      },
    });

    if (p.isCancel(urlInput)) return null;
    gatewayUrl = urlInput as string;

    // Extract port from URL for config compatibility
    try {
      const parsed = new URL(gatewayUrl);
      port = parseInt(parsed.port, 10) || 18789;
    } catch {
      port = 18789;
    }

    // Test the connection
    const testSpinner = p.spinner();
    testSpinner.start("Testing connection...");
    const ok = await testConnection(gatewayUrl, null);
    if (ok) {
      testSpinner.stop(`\x1b[92m✔\x1b[0m Gateway reachable`);
    } else {
      testSpinner.stop(pc.dim("Could not reach Gateway — it may not be running yet"));
    }
  } else {
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

    if (p.isCancel(gatewayPort)) return null;
    port = parseInt(gatewayPort as string, 10);
  }

  // Token entry
  const tokenInput = await p.text({
    message: "Gateway auth token",
    placeholder: "Paste your token (or press Enter to skip)",
    defaultValue: "",
  });

  if (p.isCancel(tokenInput)) return null;

  const token = (tokenInput as string) || null;

  return { port, token, gatewayUrl, isRemote };
}

export async function runOnboarding(): Promise<void> {

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
    const detectedPort = readOpenClawPort() || 18789;
    const token = readOpenClawToken();
    const agents = await discoverAgents(detectedPort, token);

    openclawSpinner.stop(`\x1b[92m✔\x1b[0m OpenClaw detected`);

    if (agents.length > 0 && token) {
      p.log.message(
        [
          `${pc.dim("—")} ${pc.dim(`Gateway running on port ${detectedPort}`)}`,
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

  // Step 2: Connection mode — auto-detect or manual entry
  let port = readOpenClawPort() || 18789;
  let token = readOpenClawToken();
  let gatewayUrl: string | undefined;
  let isRemote = false;

  // If we have auto-detected config, offer a choice
  const hasLocalConfig = !!readOpenClawPort() || isOpenClawInstalled();

  if (hasLocalConfig && token) {
    // Both auto-detect and manual are available
    const connectionMode = await p.select({
      message: "How would you like to connect?",
      options: [
        {
          value: "auto",
          label: `Auto-detected local Gateway ${pc.dim(`(port ${port})`)}`,
          hint: "Recommended for local setups",
        },
        {
          value: "manual",
          label: "Enter Gateway details manually",
          hint: "For remote, Tailscale, or custom setups",
        },
      ],
    });

    if (p.isCancel(connectionMode)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    if (connectionMode === "manual") {
      const manualResult = await promptManualGateway();
      if (!manualResult) {
        p.cancel("Setup cancelled.");
        process.exit(0);
      }
      port = manualResult.port;
      token = manualResult.token;
      gatewayUrl = manualResult.gatewayUrl;
      isRemote = manualResult.isRemote;
    }
  } else if (!token) {
    // No auto-detected token — fall through to manual entry
    const manualResult = await promptManualGateway();
    if (!manualResult) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }
    port = manualResult.port;
    token = manualResult.token;
    gatewayUrl = manualResult.gatewayUrl;
    isRemote = manualResult.isRemote;
  }

  // Step 3: Agent Discovery (use URL if remote, port if local)
  const agentTarget = gatewayUrl || port;
  const agents = await discoverAgents(agentTarget, token);

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
  const serverSpinner = p.spinner();
  serverSpinner.start("Saving configuration...");

  ensureCastleDir();

  const config: CastleConfig = {
    openclaw: {
      gateway_port: port,
      gateway_token: token || undefined,
      gateway_url: gatewayUrl,
      is_remote: isRemote || undefined,
      primary_agent: primaryAgent,
    },
    server: {
      port: 3333,
    },
  };

  writeConfig(config);
  serverSpinner.message("Building Castle...");

  const { spawn, exec, execSync: execSyncChild } = await import("child_process");
  const { join } = await import("path");
  const { writeFileSync: writeFile, mkdirSync: mkDir, readFileSync: readF } = await import("fs");
  const { homedir: home } = await import("os");

  const castleDir = join(home(), ".castle");
  const logsDir = join(castleDir, "logs");
  mkDir(logsDir, { recursive: true });

  // Build for production (async so the spinner can animate)
  const buildOk = await new Promise<boolean>((resolve) => {
    const child = exec("npm run build", {
      cwd: PROJECT_ROOT,
      timeout: 120000,
    });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });

  if (!buildOk) {
    serverSpinner.stop(pc.red("Build failed"));
    p.outro(pc.dim(`Try running ${BLUE("npm run build")} manually in the castle directory.`));
    return;
  }

  serverSpinner.message("Starting Castle...");

  // Find node and next paths for the service
  const nodePath = process.execPath;
  const nextBin = join(PROJECT_ROOT, "node_modules", ".bin", "next");

  // Castle port from config or default
  const castlePort = String(config.server?.port || 3333);

  // Write PID file helper
  const pidFile = join(castleDir, "server.pid");

  // Kill any existing Castle server (by PID file)
  try {
    const existingPid = parseInt(readF(pidFile, "utf-8").trim(), 10);
    if (Number.isInteger(existingPid) && existingPid > 0) {
      process.kill(existingPid);
      for (let i = 0; i < 30; i++) {
        try {
          process.kill(existingPid, 0);
          await new Promise((r) => setTimeout(r, 100));
        } catch {
          break;
        }
      }
    }
  } catch {
    // No existing server or already dead
  }

  // Kill anything else on the target port
  try {
    execSyncChild(`lsof -ti:${castlePort} | xargs kill -9 2>/dev/null`, {
      stdio: "ignore",
      timeout: 5000,
    });
    await new Promise((r) => setTimeout(r, 500));
  } catch {
    // Nothing on port or lsof not available
  }

  // Install as a persistent service (auto-start on login)
  if (process.platform === "darwin") {
    const plistDir = join(home(), "Library", "LaunchAgents");
    mkDir(plistDir, { recursive: true });
    const plistPath = join(plistDir, "com.castlekit.castle.plist");
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.castlekit.castle</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${nextBin}</string>
        <string>start</string>
        <string>-p</string>
        <string>${castlePort}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${PROJECT_ROOT}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>${logsDir}/server.log</string>
    <key>StandardErrorPath</key>
    <string>${logsDir}/server.err</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>PATH</key>
        <string>${process.env.PATH}</string>
    </dict>
</dict>
</plist>`;
    try {
      execSyncChild(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: "ignore", timeout: 10000 });
    } catch { /* ignore */ }
    writeFile(plistPath, plist);
    try {
      execSyncChild(`launchctl load "${plistPath}"`, { stdio: "ignore", timeout: 10000 });
    } catch {
      // Non-fatal — fall back to spawning directly
    }
  } else if (process.platform === "linux") {
    const systemdDir = join(home(), ".config", "systemd", "user");
    mkDir(systemdDir, { recursive: true });
    const servicePath = join(systemdDir, "castle.service");
    const service = `[Unit]
Description=Castle - The multi-agent workspace
After=network.target

[Service]
ExecStart=${nodePath} ${nextBin} start -p ${castlePort}
WorkingDirectory=${PROJECT_ROOT}
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PATH=${process.env.PATH}

[Install]
WantedBy=default.target
`;
    writeFile(servicePath, service);
    try {
      execSyncChild("systemctl --user daemon-reload && systemctl --user enable --now castle.service", { stdio: "ignore", timeout: 15000 });
    } catch {
      // Non-fatal
    }
  }

  // If no service manager started it, spawn directly
  try {
    await fetch(`http://localhost:${castlePort}`);
  } catch {
    // Server not up yet — spawn it directly as fallback
    const server = spawn(nodePath, [nextBin, "start", "-p", castlePort], {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "ignore", "ignore"],
      detached: true,
    });
    if (server.pid != null) {
      writeFile(pidFile, String(server.pid));
    }
    server.unref();
  }

  // Wait for server to be ready
  const maxWait = 45000;
  const startTime = Date.now();
  let serverReady = false;

  while (Date.now() - startTime < maxWait) {
    try {
      const res = await fetch(`http://localhost:${castlePort}`);
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
    p.outro(pc.dim(`Check logs at ${BLUE("~/.castle/logs/")}`));
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
      `  ${BLUE_BOLD("➜")}  \x1b[1m\x1b[4m\x1b[94mhttp://localhost:${castlePort}\x1b[0m`,
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

  p.outro(pc.dim(`Opening ${BLUE(`http://localhost:${castlePort}`)}...`));
  const open = (await import("open")).default;
  await open(`http://localhost:${castlePort}`);
}
