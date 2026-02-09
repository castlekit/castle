import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir, homedir } from "os";

// We test config functions that read from specific file paths.
// To avoid touching real config, we mock the homedir() to use a temp dir.

let tmpHome: string;

vi.mock("os", async () => {
  const actual = await vi.importActual<typeof import("os")>("os");
  return {
    ...actual,
    homedir: () => tmpHome,
  };
});

describe("Config", () => {
  beforeEach(() => {
    vi.resetModules();
    tmpHome = mkdtempSync(join(tmpdir(), "castle-config-test-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try { rmSync(tmpHome, { recursive: true }); } catch { /* ignore */ }
  });

  describe("getCastleDir / getConfigPath", () => {
    it("should return paths under home directory", async () => {
      const { getCastleDir, getConfigPath } = await import("../config");

      expect(getCastleDir()).toBe(join(tmpHome, ".castle"));
      expect(getConfigPath()).toBe(join(tmpHome, ".castle", "castle.json"));
    });
  });

  describe("ensureCastleDir", () => {
    it("should create .castle, data, and logs directories", async () => {
      const { ensureCastleDir, getCastleDir } = await import("../config");
      const { existsSync } = await import("fs");

      ensureCastleDir();

      expect(existsSync(getCastleDir())).toBe(true);
      expect(existsSync(join(getCastleDir(), "data"))).toBe(true);
      expect(existsSync(join(getCastleDir(), "logs"))).toBe(true);
    });
  });

  describe("readConfig / writeConfig", () => {
    it("should return default config when no file exists", async () => {
      const { readConfig } = await import("../config");

      const config = readConfig();
      expect(config.openclaw.gateway_port).toBe(18789);
      expect(config.server.port).toBe(3333);
    });

    it("should write and read back config", async () => {
      const { readConfig, writeConfig } = await import("../config");

      writeConfig({
        openclaw: { gateway_port: 19000, primary_agent: "sam" },
        server: { port: 4444 },
      });

      const config = readConfig();
      expect(config.openclaw.gateway_port).toBe(19000);
      expect(config.openclaw.primary_agent).toBe("sam");
      expect(config.server.port).toBe(4444);
    });

    it("should merge with defaults for missing fields", async () => {
      const { readConfig, ensureCastleDir, getConfigPath } = await import("../config");
      const { writeFileSync: wfs } = await import("fs");

      ensureCastleDir();
      wfs(getConfigPath(), '{ openclaw: { gateway_port: 19999 } }');

      const config = readConfig();
      expect(config.openclaw.gateway_port).toBe(19999);
      expect(config.server.port).toBe(3333); // default
    });

    it("should handle corrupted config gracefully", async () => {
      const { readConfig, ensureCastleDir, getConfigPath } = await import("../config");
      const { writeFileSync: wfs } = await import("fs");

      ensureCastleDir();
      wfs(getConfigPath(), "not valid json {{{{");

      const config = readConfig();
      // Should fall back to defaults
      expect(config.openclaw.gateway_port).toBe(18789);
    });
  });

  describe("configExists", () => {
    it("should return false when no config file", async () => {
      const { configExists } = await import("../config");
      expect(configExists()).toBe(false);
    });

    it("should return true after writing config", async () => {
      const { configExists, writeConfig } = await import("../config");

      writeConfig({
        openclaw: { gateway_port: 18789 },
        server: { port: 3333 },
      });

      expect(configExists()).toBe(true);
    });
  });

  describe("getOpenClawDir", () => {
    it("should return ~/.openclaw", async () => {
      const { getOpenClawDir } = await import("../config");
      expect(getOpenClawDir()).toBe(join(tmpHome, ".openclaw"));
    });
  });

  describe("readOpenClawToken", () => {
    it("should return null when no openclaw config exists", async () => {
      const { readOpenClawToken } = await import("../config");
      expect(readOpenClawToken()).toBeNull();
    });

    it("should read token from openclaw.json", async () => {
      const { readOpenClawToken } = await import("../config");

      const openclawDir = join(tmpHome, ".openclaw");
      mkdirSync(openclawDir, { recursive: true });
      writeFileSync(
        join(openclawDir, "openclaw.json"),
        JSON.stringify({ gateway: { auth: { token: "rew_test123" } } })
      );

      expect(readOpenClawToken()).toBe("rew_test123");
    });

    it("should resolve ${ENV_VAR} references", async () => {
      const { readOpenClawToken } = await import("../config");

      // Set env var
      process.env.TEST_OC_TOKEN = "rew_from_env";

      const openclawDir = join(tmpHome, ".openclaw");
      mkdirSync(openclawDir, { recursive: true });
      writeFileSync(
        join(openclawDir, "openclaw.json"),
        JSON.stringify({ gateway: { auth: { token: "${TEST_OC_TOKEN}" } } })
      );

      expect(readOpenClawToken()).toBe("rew_from_env");

      delete process.env.TEST_OC_TOKEN;
    });

    it("should load .env file for env var resolution", async () => {
      const { readOpenClawToken } = await import("../config");

      const openclawDir = join(tmpHome, ".openclaw");
      mkdirSync(openclawDir, { recursive: true });

      // Write .env
      writeFileSync(join(openclawDir, ".env"), 'ENV_TOKEN_TEST=rew_dotenv_val');

      // Write config referencing the env var
      writeFileSync(
        join(openclawDir, "openclaw.json"),
        JSON.stringify({ gateway: { auth: { token: "${ENV_TOKEN_TEST}" } } })
      );

      expect(readOpenClawToken()).toBe("rew_dotenv_val");

      delete process.env.ENV_TOKEN_TEST;
    });
  });

  describe("readOpenClawPort", () => {
    it("should return null when no config exists", async () => {
      const { readOpenClawPort } = await import("../config");
      expect(readOpenClawPort()).toBeNull();
    });

    it("should read port from openclaw.json", async () => {
      const { readOpenClawPort } = await import("../config");

      const openclawDir = join(tmpHome, ".openclaw");
      mkdirSync(openclawDir, { recursive: true });
      writeFileSync(
        join(openclawDir, "openclaw.json"),
        JSON.stringify({ gateway: { port: 19999 } })
      );

      expect(readOpenClawPort()).toBe(19999);
    });

    it("should reject invalid ports", async () => {
      const { readOpenClawPort } = await import("../config");

      const openclawDir = join(tmpHome, ".openclaw");
      mkdirSync(openclawDir, { recursive: true });
      writeFileSync(
        join(openclawDir, "openclaw.json"),
        JSON.stringify({ gateway: { port: 99999 } })
      );

      expect(readOpenClawPort()).toBeNull();
    });
  });

  describe("getGatewayUrl", () => {
    it("should use env var if set", async () => {
      process.env.OPENCLAW_GATEWAY_URL = "ws://remote:9999";
      const { getGatewayUrl } = await import("../config");

      expect(getGatewayUrl()).toBe("ws://remote:9999");

      delete process.env.OPENCLAW_GATEWAY_URL;
    });

    it("should use config gateway_url if set", async () => {
      const { getGatewayUrl, writeConfig } = await import("../config");

      writeConfig({
        openclaw: { gateway_port: 18789, gateway_url: "ws://tailscale:18789" },
        server: { port: 3333 },
      });

      expect(getGatewayUrl()).toBe("ws://tailscale:18789");
    });

    it("should default to localhost with configured port", async () => {
      const { getGatewayUrl } = await import("../config");

      // No env var, no gateway_url — uses default port
      expect(getGatewayUrl()).toBe("ws://127.0.0.1:18789");
    });
  });

  describe("isOpenClawInstalled", () => {
    it("should return false when ~/.openclaw does not exist", async () => {
      const { isOpenClawInstalled } = await import("../config");
      expect(isOpenClawInstalled()).toBe(false);
    });

    it("should return true when ~/.openclaw exists", async () => {
      mkdirSync(join(tmpHome, ".openclaw"), { recursive: true });
      const { isOpenClawInstalled } = await import("../config");
      expect(isOpenClawInstalled()).toBe(true);
    });
  });
});
