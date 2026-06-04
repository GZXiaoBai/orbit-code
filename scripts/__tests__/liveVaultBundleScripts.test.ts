import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const bootstrapReportPath = path.join(repoRoot, "docs/smoke/latest-live-vault-bootstrap.json");
const defaultBundlePath = path.join(repoRoot, ".qa/orbit-live-vault-bundle.b64");
const sqliteAvailable = spawnSync("sqlite3", ["--version"], { encoding: "utf8" }).status === 0;
const sqliteIt = sqliteAvailable ? it : it.skip;

function runScript(script: string, env: Record<string, string | undefined>) {
  return spawnSync(process.execPath, [path.join(repoRoot, script)], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function makeFakeVault(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, "orbit_code.db");
  const trustedDeviceKey = crypto.randomBytes(32);
  const autoUnlockEnvelope = {
    version: 1,
    nonce: crypto.randomBytes(12).toString("base64"),
    ciphertext: crypto.randomBytes(96).toString("base64"),
  };
  const deepseekEnvelope = {
    version: 1,
    provider: "deepseek",
    kdf: "argon2id:m=19456,t=2,p=1",
    salt: crypto.randomBytes(16).toString("base64"),
    nonce: crypto.randomBytes(12).toString("base64"),
    ciphertext: crypto.randomBytes(80).toString("base64"),
  };
  const sql = [
    "CREATE TABLE kv_store (key TEXT PRIMARY KEY, value TEXT);",
    "CREATE TABLE noisy_source_data (id TEXT PRIMARY KEY, payload BLOB);",
    `INSERT INTO kv_store (key, value) VALUES ('credential.vault.auto_unlock', '${JSON.stringify(autoUnlockEnvelope).replace(/'/g, "''")}');`,
    `INSERT INTO kv_store (key, value) VALUES ('credential.vault.deepseek', '${JSON.stringify(deepseekEnvelope).replace(/'/g, "''")}');`,
    "INSERT INTO noisy_source_data (id, payload) VALUES ('large-row', randomblob(250000));",
  ].join("\n");
  const created = spawnSync("sqlite3", [dbPath], { input: sql, encoding: "utf8" });
  if (created.status !== 0) {
    throw new Error(created.stderr || "failed to create fake SQLite vault");
  }
  fs.writeFileSync(
    path.join(dir, "orbit-device-unlock.key"),
    `${trustedDeviceKey.toString("base64")}\n`,
    { mode: 0o600 },
  );
}

afterEach(() => {
  fs.rmSync(bootstrapReportPath, { force: true });
  fs.rmSync(defaultBundlePath, { force: true });
});

describe("live vault bundle scripts", () => {
  sqliteIt("exports a minimal encrypted vault bundle and bootstraps it without printing bundle contents", () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-vault-source-"));
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-vault-target-"));
    const bundlePath = path.join(os.tmpdir(), `orbit-vault-${crypto.randomUUID()}.b64`);
    makeFakeVault(sourceDir);

    try {
      const exported = runScript("scripts/export-live-vault-bundle.mjs", {
        ORBIT_APP_DATA_DIR: sourceDir,
        ORBIT_LIVE_VAULT_BUNDLE_OUT: bundlePath,
      });

      expect(exported.status).toBe(0);
      expect(fs.existsSync(bundlePath)).toBe(true);
      const bundleSecret = fs.readFileSync(bundlePath, "utf8").trim();
      expect(bundleSecret.length).toBeGreaterThan(100);
      expect(bundleSecret.length).toBeLessThan(48_000);
      expect(exported.stdout).toContain("minimized encrypted vault database");
      expect(exported.stdout).toContain("gh secret set ORBIT_LIVE_VAULT_BUNDLE_B64");
      expect(exported.stdout).not.toContain(bundleSecret.slice(0, 32));

      const bootstrapped = runScript("scripts/bootstrap-live-vault.mjs", {
        ORBIT_APP_DATA_DIR: targetDir,
        ORBIT_LIVE_VAULT_BUNDLE_B64: bundleSecret,
      });

      expect(bootstrapped.status).toBe(0);
      expect(fs.existsSync(path.join(targetDir, "orbit_code.db"))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, "orbit-device-unlock.key"))).toBe(true);
      expect(bootstrapped.stdout).toContain("Result: verified");
      expect(bootstrapped.stdout).not.toContain(bundleSecret.slice(0, 32));

      const report = JSON.parse(fs.readFileSync(bootstrapReportPath, "utf8"));
      expect(report.result).toBe("verified");
      expect(report.criteria.map((item: { id: string }) => item.id)).toContain("bundle-installed");
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
      fs.rmSync(targetDir, { recursive: true, force: true });
      fs.rmSync(bundlePath, { force: true });
    }
  });

  it("writes a blocked bootstrap report when the bundle secret is missing", () => {
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-vault-missing-secret-"));

    try {
      const bootstrapped = runScript("scripts/bootstrap-live-vault.mjs", {
        ORBIT_APP_DATA_DIR: targetDir,
        ORBIT_LIVE_VAULT_BUNDLE_B64: "",
      });

      expect(bootstrapped.status).toBe(1);
      expect(bootstrapped.stderr).toContain("ORBIT_LIVE_VAULT_BUNDLE_B64 is required");
      const report = JSON.parse(fs.readFileSync(bootstrapReportPath, "utf8"));
      expect(report.result).toBe("blocked");
      expect(report.criteria[1]).toMatchObject({
        id: "bundle-secret-present",
        status: "blocked",
      });
    } finally {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  });
});
