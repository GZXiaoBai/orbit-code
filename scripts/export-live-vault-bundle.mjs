#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const APP_SUPPORT = process.env.ORBIT_APP_DATA_DIR
  ? path.resolve(process.env.ORBIT_APP_DATA_DIR)
  : path.join(os.homedir(), "Library/Application Support/com.zhoujunjie.orbitcode");
const DB_PATH = process.env.ORBIT_DB_PATH || path.join(APP_SUPPORT, "orbit_code.db");
const DEVICE_KEY_PATH = process.env.ORBIT_DEVICE_KEY_PATH || path.join(APP_SUPPORT, "orbit-device-unlock.key");
const OUTPUT_PATH = process.env.ORBIT_LIVE_VAULT_BUNDLE_OUT
  ? path.resolve(process.env.ORBIT_LIVE_VAULT_BUNDLE_OUT)
  : path.resolve(".qa/orbit-live-vault-bundle.b64");
const GITHUB_SECRET_MAX_BYTES = 48_000;
const VAULT_KEY_PREFIX = "credential.vault.";
const REQUIRED_VAULT_KEYS = ["credential.vault.auto_unlock", "credential.vault.deepseek"];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readRequiredFile(filePath, label) {
  if (!fs.existsSync(filePath)) fail(`${label} not found at ${filePath}`);
  const bytes = fs.readFileSync(filePath);
  if (bytes.length === 0) fail(`${label} is empty at ${filePath}`);
  return bytes;
}

function validateDb(bytes) {
  const header = bytes.subarray(0, 16).toString("utf8");
  if (header !== "SQLite format 3\0") {
    fail("orbit_code.db does not look like a SQLite database.");
  }
}

function validateDeviceKey(bytes) {
  try {
    const decoded = Buffer.from(bytes.toString("utf8").trim(), "base64");
    if (decoded.length !== 32) {
      fail(`orbit-device-unlock.key decoded length is ${decoded.length}; expected 32 bytes.`);
    }
  } catch (error) {
    fail(`orbit-device-unlock.key is not valid base64: ${error?.message || error}`);
  }
}

function writePrivateFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, content, { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Windows does not support POSIX modes; the caller should keep the output path private.
  }
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runSqlite(args, options = {}) {
  try {
    return execFileSync("sqlite3", args, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      ...options,
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      fail("sqlite3 is required to export a minimal live vault bundle. Install sqlite3 and retry.");
    }
    const stderr = error.stderr?.toString?.() || "";
    fail(`sqlite3 failed while exporting the live vault bundle: ${stderr || error.message || error}`);
  }
}

function readVaultRows(dbPath) {
  const raw = runSqlite([
    "-json",
    dbPath,
    `SELECT key, value FROM kv_store WHERE key LIKE '${VAULT_KEY_PREFIX}%' ORDER BY key;`,
  ]).trim();
  const rows = raw ? JSON.parse(raw) : [];
  const keys = new Set(rows.map((row) => row.key));
  for (const key of REQUIRED_VAULT_KEYS) {
    if (!keys.has(key)) {
      fail(`${key} is missing from the Orbit credential vault. Enable trusted-device auto-unlock and save the DeepSeek credential before exporting.`);
    }
  }
  return rows;
}

function createMinimalVaultDb(rows) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-live-vault-export-"));
  const target = path.join(tempDir, "orbit_code.db");
  try {
    const inserts = rows
      .map((row) => `INSERT INTO kv_store (key, value) VALUES (${sqlString(row.key)}, ${sqlString(row.value)});`)
      .join("\n");
    runSqlite([target], {
      input: [
        "PRAGMA journal_mode=DELETE;",
        "CREATE TABLE kv_store (key TEXT PRIMARY KEY, value TEXT);",
        inserts,
        "VACUUM;",
      ].join("\n"),
    });
    const bytes = readRequiredFile(target, "minimal orbit_code.db");
    validateDb(bytes);
    return bytes;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

const dbBytes = readRequiredFile(DB_PATH, "orbit_code.db");
const deviceKeyBytes = readRequiredFile(DEVICE_KEY_PATH, "orbit-device-unlock.key");
validateDb(dbBytes);
validateDeviceKey(deviceKeyBytes);
const vaultRows = readVaultRows(DB_PATH);
const minimalDbBytes = createMinimalVaultDb(vaultRows);

const bundle = {
  version: 1,
  minimized: true,
  files: {
    "orbit_code.db": minimalDbBytes.toString("base64"),
    "orbit-device-unlock.key": deviceKeyBytes.toString("base64"),
  },
};
const bundleB64 = Buffer.from(JSON.stringify(bundle)).toString("base64");
if (Buffer.byteLength(bundleB64, "utf8") > GITHUB_SECRET_MAX_BYTES) {
  fail(`Orbit live vault bundle is ${Buffer.byteLength(bundleB64, "utf8")} bytes, above GitHub's ${GITHUB_SECRET_MAX_BYTES} byte secret limit.`);
}
writePrivateFile(OUTPUT_PATH, `${bundleB64}\n`);

console.log(`Orbit live vault bundle written to ${OUTPUT_PATH}`);
console.log(`Bundle contains a minimized encrypted vault database with ${vaultRows.length} credential rows and the trusted-device unlock key.`);
console.log("This file contains encrypted credential material. Keep it private and delete it after setting the CI secret.");
console.log(`Set the GitHub environment secret with: gh secret set ORBIT_LIVE_VAULT_BUNDLE_B64 --env orbit-live-smoke < ${OUTPUT_PATH}`);
