import * as p from "@clack/prompts";
import pc from "picocolors";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import WebSocket from "ws";
import { readFileSync, existsSync } from "fs";
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

  // Node 22+ is required for native fetch, compile cache, and modern APIs
  const nodeVersion = parseInt(process.versions.node.split(".")[0], 10);
  if (nodeVersion < 22) {
    p.intro(BLUE_BOLD("Castle Setup"));
    p.log.error(
      pc.red(`Node.js 22 or higher is required (you have v${process.versions.node}).`) +
      "\n" +
      pc.dim("  Install it from https://nodejs.org or via nvm:\n") +
      BLUE("  nvm install 22 && nvm use 22")
    );
    p.outro(pc.dim("Then run castle setup again."));
    return;
  }

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

      const installCmd = process.platform === "win32"
        ? 'powershell -NoProfile -ExecutionPolicy Bypass -Command "& { iwr -useb https://openclaw.ai/install.ps1 | iex } -NoOnboard"'
        : 'curl -fsSL --proto "=https" --tlsv1.2 https://openclaw.ai/install.sh | bash -s -- --no-onboard --no-prompt';

      try {
        execSync(installCmd, { stdio: "pipe", timeout: 120000 });
        installSpinner.stop(BLUE("✔ OpenClaw installed"));
      } catch (error) {
        installSpinner.stop(pc.red("OpenClaw installation failed"));
        const manualCmd = process.platform === "win32"
          ? "iwr -useb https://openclaw.ai/install.ps1 | iex"
          : "curl -fsSL https://openclaw.ai/install.sh | bash";
        p.note(
          `Install OpenClaw manually:\n${BLUE_LIGHT(manualCmd)}\n\nThen run: ${BLUE_LIGHT("castle setup")}`,
          BLUE_BOLD("Manual Install")
        );
        p.outro("Come back when OpenClaw is installed!");
        process.exit(1);
      }
    } else {
      const manualCmd = process.platform === "win32"
        ? "iwr -useb https://openclaw.ai/install.ps1 | iex"
        : "curl -fsSL https://openclaw.ai/install.sh | bash";
      p.note(
        `Install OpenClaw:\n${BLUE_LIGHT(manualCmd)}\n\nThen come back and run:\n${BLUE_LIGHT("castle setup")}`,
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

  const { spawn, exec, execSync: execSyncChild } = await import("child_process");
  const { join } = await import("path");
  const { writeFileSync: writeFile, mkdirSync: mkDir, readFileSync: readF } = await import("fs");
  const { homedir: home } = await import("os");

  const castleDir = join(home(), ".castle");
  const logsDir = join(castleDir, "logs");
  mkDir(logsDir, { recursive: true });

  // Check if the app was pre-built (npm publish ships .next/standalone/)
  const standaloneServer = join(PROJECT_ROOT, ".next", "standalone", "server.js");
  const hasPrebuilt = existsSync(standaloneServer);

  if (hasPrebuilt) {
    serverSpinner.message("Pre-built Castle detected — skipping build...");
  } else {
    // Dev / git-clone install — need to build from source
    serverSpinner.message("Building Castle...");

    const buildLogPath = join(logsDir, "build.log");

    const buildOk = await new Promise<boolean>((resolve) => {
      let output = "";
      const child = exec("npm run build", {
        cwd: PROJECT_ROOT,
        timeout: 180000,
      });
      child.stdout?.on("data", (d: string) => { output += d; });
      child.stderr?.on("data", (d: string) => { output += d; });
      child.on("close", (code) => {
        // Write full output to log file
        try { writeFile(buildLogPath, output); } catch { /* ignore */ }
        resolve(code === 0);
      });
      child.on("error", (err) => {
        try { writeFile(buildLogPath, output + "\n" + String(err)); } catch { /* ignore */ }
        resolve(false);
      });
    });

    if (!buildOk) {
      serverSpinner.stop(pc.red("Build failed"));
      // Show the last 20 lines of build output so the user can see what went wrong
      try {
        const log = readF(buildLogPath, "utf-8");
        const lines = log.split("\n");
        const tail = lines.slice(-20).join("\n");
        p.log.error(pc.dim("Last 20 lines of build output:\n") + tail);
      } catch { /* log unavailable */ }
      p.outro(
        pc.dim(`Full build log: ${BLUE(`~/.castle/logs/build.log`)}\n`) +
        pc.dim(`Try running ${BLUE("npm run build")} manually in the castle directory.`)
      );
      return;
    }
  }

  serverSpinner.message("Starting Castle...");

  // Find node path and determine how to start the server
  const nodePath = process.execPath;
  const nextBin = join(PROJECT_ROOT, "node_modules", ".bin", "next");

  // Use standalone server.js when pre-built (global installs), fall back to next start
  const useStandalone = existsSync(join(PROJECT_ROOT, ".next", "standalone", "server.js"));
  const serverScript = useStandalone
    ? join(PROJECT_ROOT, ".next", "standalone", "server.js")
    : null;

  // Build the program args for the service and direct spawn
  const serverArgs = serverScript
    ? [serverScript]
    : [nextBin, "start", "-p", String(config.server?.port || 3333)];

  // Environment for standalone mode needs PORT, HOSTNAME, and NODE_PATH
  // NODE_PATH is critical: the standalone bundle ships without node_modules
  // (native modules like better-sqlite3 are platform-specific and can't be
  // bundled cross-platform). NODE_PATH tells Node to resolve packages from
  // the package root's node_modules/ where npm installed correct binaries.
  const serverEnv: Record<string, string> = {
    NODE_ENV: "production",
    PATH: process.env.PATH || "",
  };
  if (serverScript) {
    serverEnv.PORT = String(config.server?.port || 3333);
    serverEnv.HOSTNAME = "127.0.0.1";
    serverEnv.NODE_PATH = join(PROJECT_ROOT, "node_modules");
  }

  // Castle port from config or default
  const castlePort = String(config.server?.port || 3333);

  // Write PID file helper
  const pidFile = join(castleDir, "server.pid");
  const isWin = process.platform === "win32";

  // Stop existing service FIRST — otherwise the service manager respawns
  // the old server immediately after we kill it, stealing the port.
  if (process.platform === "darwin") {
    const plistPath = join(home(), "Library", "LaunchAgents", "com.castlekit.castle.plist");
    try {
      execSyncChild(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: "ignore", timeout: 10000 });
    } catch { /* no existing service */ }
  } else if (process.platform === "linux") {
    try {
      execSyncChild("systemctl --user stop castle.service 2>/dev/null", { stdio: "ignore", timeout: 10000 });
    } catch { /* no existing service */ }
  } else if (isWin) {
    try {
      execSyncChild('schtasks /End /TN "CastleServer" 2>nul', { stdio: "ignore", timeout: 10000 });
    } catch { /* no existing task */ }
    try {
      execSyncChild('schtasks /Delete /TN "CastleServer" /F 2>nul', { stdio: "ignore", timeout: 10000 });
    } catch { /* no existing task */ }
  }

  // Kill any existing Castle server (by PID file)
  try {
    const existingPid = parseInt(readF(pidFile, "utf-8").trim(), 10);
    if (Number.isInteger(existingPid) && existingPid > 0) {
      if (isWin) {
        try { execSyncChild(`taskkill /PID ${existingPid} /F 2>nul`, { stdio: "ignore", timeout: 5000 }); } catch { /* ignore */ }
      } else {
        process.kill(existingPid);
      }
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
  if (isWin) {
    try {
      const netstatOut = execSyncChild(
        `netstat -ano | findstr ":${castlePort} " | findstr "LISTENING"`,
        { encoding: "utf-8", timeout: 5000 }
      ).toString();
      const pids = new Set<string>();
      for (const line of netstatOut.split("\n")) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid) && pid !== "0") pids.add(pid);
      }
      for (const pid of pids) {
        try { execSyncChild(`taskkill /PID ${pid} /F 2>nul`, { stdio: "ignore", timeout: 5000 }); } catch { /* ignore */ }
      }
      if (pids.size > 0) await new Promise((r) => setTimeout(r, 500));
    } catch {
      // Nothing on port or netstat not available
    }
  } else {
    try {
      execSyncChild(`lsof -ti:${castlePort} | xargs kill -9 2>/dev/null`, {
        stdio: "ignore",
        timeout: 5000,
      });
      await new Promise((r) => setTimeout(r, 500));
    } catch {
      // Nothing on port or lsof not available
    }
  }

  // Escape XML special characters for plist values
  const xmlEscape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // Install as a persistent service (auto-start on login)
  if (process.platform === "darwin") {
    const plistDir = join(home(), "Library", "LaunchAgents");
    mkDir(plistDir, { recursive: true });
    const plistPath = join(plistDir, "com.castlekit.castle.plist");
    const plistArgs = [nodePath, ...serverArgs]
      .map((a) => `        <string>${xmlEscape(a)}</string>`)
      .join("\n");
    const plistEnvEntries = Object.entries(serverEnv)
      .map(([k, v]) => `        <key>${xmlEscape(k)}</key>\n        <string>${xmlEscape(v)}</string>`)
      .join("\n");
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.castlekit.castle</string>
    <key>ProgramArguments</key>
    <array>
${plistArgs}
    </array>
    <key>WorkingDirectory</key>
    <string>${xmlEscape(PROJECT_ROOT)}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>${xmlEscape(logsDir)}/server.log</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(logsDir)}/server.err</string>
    <key>EnvironmentVariables</key>
    <dict>
${plistEnvEntries}
    </dict>
</dict>
</plist>`;
    // Service was already unloaded above — just write new plist and load
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
    const systemdEnvLines = Object.entries(serverEnv)
      .map(([k, v]) => `Environment=${k}=${v}`)
      .join("\n");
    const execStartCmd = [nodePath, ...serverArgs].join(" ");
    const service = `[Unit]
Description=Castle - The multi-agent workspace
After=network.target

[Service]
ExecStart=${execStartCmd}
WorkingDirectory=${PROJECT_ROOT}
Restart=on-failure
RestartSec=5
${systemdEnvLines}

[Install]
WantedBy=default.target
`;
    writeFile(servicePath, service);
    try {
      execSyncChild("systemctl --user daemon-reload && systemctl --user enable --now castle.service", { stdio: "ignore", timeout: 15000 });
    } catch {
      // Non-fatal
    }
  } else if (isWin) {
    // Windows: use Task Scheduler to run Castle at logon
    // Build a batch wrapper that sets environment variables and starts the server
    const batPath = join(castleDir, "start-server.bat");
    const envLines = Object.entries(serverEnv)
      .map(([k, v]) => `set "${k}=${v}"`)
      .join("\r\n");
    const batContent = `@echo off\r\n${envLines}\r\ncd /d "${PROJECT_ROOT}"\r\n"${nodePath}" ${serverArgs.map((a) => `"${a}"`).join(" ")}\r\n`;
    writeFile(batPath, batContent);

    // Task was already deleted above — create fresh
    try {
      execSyncChild(
        `schtasks /Create /TN "CastleServer" /TR "\\"${batPath}\\"" /SC ONLOGON /RL HIGHEST /F 2>nul`,
        { stdio: "ignore", timeout: 10000 }
      );
    } catch {
      // Non-fatal — fall back to spawning directly
    }

    // Also start the task now
    try {
      execSyncChild('schtasks /Run /TN "CastleServer" 2>nul', { stdio: "ignore", timeout: 10000 });
    } catch {
      // Non-fatal
    }
  }

  // If no service manager started it, spawn directly
  try {
    await fetch(`http://localhost:${castlePort}`);
  } catch {
    // Server not up yet — spawn it directly as fallback
    const server = spawn(nodePath, serverArgs, {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "ignore", "ignore"],
      detached: true,
      env: { ...process.env, ...serverEnv },
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
