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
 * Try to read the OpenClaw gateway token from ~/.openclaw/openclaw.json
 */
export function readOpenClawToken(): string | null {
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
        return token;
      }
    } catch {
      // Continue to next path
    }
  }
  return null;
}

/**
 * Check if OpenClaw is installed by looking for the config directory
 */
export function isOpenClawInstalled(): boolean {
  return existsSync(join(homedir(), ".openclaw"));
}
