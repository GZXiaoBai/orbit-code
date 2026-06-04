#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { timestampId, writeSmokeReport } from "./smoke-report.mjs";

const APP_DATA_DIR = process.env.ORBIT_APP_DATA_DIR;
const BUNDLE_B64 = process.env.ORBIT_LIVE_VAULT_BUNDLE_B64;
const REPORT_NAME = "live-vault-bootstrap";

function criterion(id, label, ok, message, evidence = {}) {
  return {
    id,
    label,
    status: ok ? "verified" : "blocked",
    message,
    evidence,
  };
}

function writeReport(startedAt, criteria) {
  const completedAt = new Date().toISOString();
  const result = criteria.every((item) => item.status === "verified") ? "verified" : "blocked";
  const report = {
    id: timestampId(REPORT_NAME, new Date(completedAt)),
    runtime: "codex-sidecar.v1",
    provider: "deepseek",
    scope: "CI bootstrap for credentialed desktop Build live smoke. This decodes a base64 JSON bundle into ORBIT_APP_DATA_DIR without logging or persisting plaintext provider credentials.",
    startedAt,
    completedAt,
    result,
    criteria,
  };
  writeSmokeReport(REPORT_NAME, report, "Live vault bootstrap report");
  return result;
}

function fail(startedAt, criteria, message) {
  const result = writeReport(startedAt, criteria);
  console.error(message);
  console.error("Configure the protected GitHub environment secret orbit-live-smoke/ORBIT_LIVE_VAULT_BUNDLE_B64 with the bundle shape documented in docs/smoke/README.md.");
  process.exit(result === "verified" ? 0 : 1);
}

function decodeBase64(value, label) {
  const cleaned = value.replace(/\s+/g, "");
  const decoded = Buffer.from(cleaned, "base64");
  if (decoded.length === 0 || decoded.toString("base64").replace(/=+$/, "") !== cleaned.replace(/=+$/, "")) {
    throw new Error(`${label} is not valid base64.`);
  }
  return decoded;
}

function readBundle(startedAt, criteria) {
  if (!BUNDLE_B64?.trim()) {
    criteria.push(criterion(
      "bundle-secret-present",
      "ORBIT_LIVE_VAULT_BUNDLE_B64 environment secret is available.",
      false,
      "ORBIT_LIVE_VAULT_BUNDLE_B64 is empty or missing.",
      { environment: "orbit-live-smoke", secretName: "ORBIT_LIVE_VAULT_BUNDLE_B64" },
    ));
    fail(startedAt, criteria, "ORBIT_LIVE_VAULT_BUNDLE_B64 is required.");
  }
  criteria.push(criterion(
    "bundle-secret-present",
    "ORBIT_LIVE_VAULT_BUNDLE_B64 environment secret is available.",
    true,
    "Secret is present; value is not printed.",
  ));
  try {
    const raw = decodeBase64(BUNDLE_B64, "ORBIT_LIVE_VAULT_BUNDLE_B64").toString("utf8");
    const parsed = JSON.parse(raw);
    criteria.push(criterion(
      "bundle-json",
      "Live vault bundle decodes as JSON.",
      true,
      "Bundle JSON decoded.",
      { version: parsed.version ?? null, hasFilesObject: Boolean(parsed.files && typeof parsed.files === "object") },
    ));
    return parsed;
  } catch (error) {
    criteria.push(criterion(
      "bundle-json",
      "Live vault bundle decodes as JSON.",
      false,
      error instanceof Error ? error.message : String(error),
    ));
    fail(startedAt, criteria, `Unable to decode ORBIT_LIVE_VAULT_BUNDLE_B64: ${error?.message || error}`);
  }
}

function fileFromBundle(startedAt, criteria, bundle, name, aliases = []) {
  const value = bundle.files?.[name]
    || aliases.map((alias) => bundle[alias]).find(Boolean);
  if (!value) {
    criteria.push(criterion(
      `bundle-file-${name}`,
      `Live vault bundle includes ${name}.`,
      false,
      `Live vault bundle is missing ${name}.`,
      { acceptedAliases: aliases },
    ));
    fail(startedAt, criteria, `Live vault bundle is missing ${name}.`);
  }
  try {
    const fileBytes = decodeBase64(value, name);
    criteria.push(criterion(
      `bundle-file-${name}`,
      `Live vault bundle includes ${name}.`,
      true,
      `${name} decoded.`,
      { byteLength: fileBytes.length, acceptedAliases: aliases },
    ));
    return fileBytes;
  } catch (error) {
    criteria.push(criterion(
      `bundle-file-${name}`,
      `Live vault bundle includes ${name}.`,
      false,
      error instanceof Error ? error.message : String(error),
      { acceptedAliases: aliases },
    ));
    fail(startedAt, criteria, `Unable to decode ${name} from live vault bundle: ${error?.message || error}`);
  }
}

function writePrivateFile(filePath, content) {
  fs.writeFileSync(filePath, content, { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Windows does not support POSIX modes; the CI runner still keeps this temp dir private.
  }
}

function validateBundleFiles(startedAt, criteria, dbBytes, deviceKeyBytes) {
  const dbHeader = dbBytes.subarray(0, 16).toString("utf8");
  criteria.push(criterion(
    "database-shape",
    "orbit_code.db bytes look like a SQLite database.",
    dbHeader === "SQLite format 3\0",
    dbHeader === "SQLite format 3\0" ? "SQLite header verified." : "orbit_code.db does not have a SQLite header.",
  ));

  try {
    const trustedDeviceKey = Buffer.from(deviceKeyBytes.toString("utf8").trim(), "base64");
    criteria.push(criterion(
      "device-key-shape",
      "orbit-device-unlock.key contains a 32-byte base64 trusted-device key.",
      trustedDeviceKey.length === 32,
      trustedDeviceKey.length === 32 ? "Trusted-device key shape verified." : `Decoded key length is ${trustedDeviceKey.length}.`,
    ));
  } catch (error) {
    criteria.push(criterion(
      "device-key-shape",
      "orbit-device-unlock.key contains a 32-byte base64 trusted-device key.",
      false,
      error instanceof Error ? error.message : String(error),
    ));
  }

  if (criteria.some((item) => item.status !== "verified")) {
    fail(startedAt, criteria, "Live vault bundle failed validation.");
  }
}

function main() {
  const startedAt = new Date().toISOString();
  const criteria = [];

  if (!APP_DATA_DIR?.trim()) {
    criteria.push(criterion(
      "app-data-dir",
      "ORBIT_APP_DATA_DIR points at the temporary app data directory.",
      false,
      "ORBIT_APP_DATA_DIR is missing.",
    ));
    fail(startedAt, criteria, "ORBIT_APP_DATA_DIR is required.");
  }
  const appDataDir = path.resolve(APP_DATA_DIR);
  criteria.push(criterion(
    "app-data-dir",
    "ORBIT_APP_DATA_DIR points at the temporary app data directory.",
    true,
    "App data directory resolved.",
    { appDataDir },
  ));

  const bundle = readBundle(startedAt, criteria);
  const dbBytes = fileFromBundle(startedAt, criteria, bundle, "orbit_code.db", ["orbitCodeDbB64", "databaseB64", "dbB64"]);
  const deviceKeyBytes = fileFromBundle(startedAt, criteria, bundle, "orbit-device-unlock.key", ["deviceKeyB64", "trustedDeviceKeyB64"]);
  validateBundleFiles(startedAt, criteria, dbBytes, deviceKeyBytes);

  fs.mkdirSync(appDataDir, { recursive: true, mode: 0o700 });
  writePrivateFile(path.join(appDataDir, "orbit_code.db"), dbBytes);
  writePrivateFile(path.join(appDataDir, "orbit-device-unlock.key"), deviceKeyBytes);
  criteria.push(criterion(
    "bundle-installed",
    "Encrypted live vault files are installed into ORBIT_APP_DATA_DIR.",
    true,
    "Bundle files installed with private file permissions.",
    { files: ["orbit_code.db", "orbit-device-unlock.key"] },
  ));

  const result = writeReport(startedAt, criteria);
  console.log(`Orbit live vault bundle installed into ${appDataDir}`);
  console.log(`Result: ${result}`);
  if (result !== "verified") process.exit(1);
}

main();
