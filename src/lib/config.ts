import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import JSON5 from "json5";

export interface CastleConfig {
  openclaw: {
    gateway_port: number;
    gateway_token?: string;
    primary_agent?: string;
  };
  server: {
    port: number;
  };
}

const DEFAULT_CONFIG: CastleConfig = {
  openclaw: {
    gateway_port: 18789,
  },
  server: {
    port: 3333,
  },
};

export function getCastleDir(): string {
  return join(homedir(), ".castle");
}

export function getConfigPath(): string {
  return join(getCastleDir(), "castle.json");
}

export function ensureCastleDir(): void {
  const dir = getCastleDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const dataDir = join(dir, "data");
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

export function configExists(): boolean {
  return existsSync(getConfigPath());
}

export function readConfig(): CastleConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON5.parse(raw);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      openclaw: { ...DEFAULT_CONFIG.openclaw, ...parsed.openclaw },
      server: { ...DEFAULT_CONFIG.server, ...parsed.server },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(config: CastleConfig): void {
  ensureCastleDir();
  const configPath = getConfigPath();
  const content = JSON5.stringify(config, null, 2);
  writeFileSync(configPath, content, "utf-8");
}

/**
 * Load a .env file and set values into process.env (does not override existing)
 */
function loadEnvFile(envPath: string): void {
  if (!existsSync(envPath)) return;
  try {
    const raw = readFileSync(envPath, "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // Ignore errors loading .env
  }
}

/**
 * Resolve ${ENV_VAR} references in a string value.
 * Users often have "token": "${OPENCLAW_GATEWAY_TOKEN}" in their config.
 */
function resolveEnvVar(value: string): string | null {
  if (value.startsWith("${") && value.endsWith("}")) {
    const envVar = value.slice(2, -1);
    return process.env[envVar] || null;
  }
  return value;
}

/**
 * Get the OpenClaw directory path
 */
export function getOpenClawDir(): string {
  return join(homedir(), ".openclaw");
}

/**
 * Try to read the OpenClaw gateway token from ~/.openclaw/openclaw.json
 * Handles ${ENV_VAR} references and loads ~/.openclaw/.env
 */
export function readOpenClawToken(): string | null {
  // Load ~/.openclaw/.env first so env var references can resolve
  loadEnvFile(join(getOpenClawDir(), ".env"));

  const paths = [
    join(homedir(), ".openclaw", "openclaw.json"),
    join(homedir(), ".openclaw", "openclaw.json5"),
  ];

  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, "utf-8");
      const parsed = JSON5.parse(raw);
      const token = parsed?.gateway?.auth?.token;
      if (token && typeof token === "string") {
        return resolveEnvVar(token);
      }
    } catch {
      // Continue to next path
    }
  }

  // Fallback: check env vars directly
  return process.env.OPENCLAW_GATEWAY_TOKEN || null;
}

/**
 * Get the Gateway WebSocket URL.
 * Supports OPENCLAW_GATEWAY_URL env var, falls back to config port.
 */
export function getGatewayUrl(): string {
  if (process.env.OPENCLAW_GATEWAY_URL) {
    return process.env.OPENCLAW_GATEWAY_URL;
  }
  const config = readConfig();
  return `ws://127.0.0.1:${config.openclaw.gateway_port}`;
}

/**
 * Check if OpenClaw is installed by looking for the config directory
 */
export function isOpenClawInstalled(): boolean {
  return existsSync(join(homedir(), ".openclaw"));
}
