#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const APP_DATA_DIR = process.env.ORBIT_APP_DATA_DIR;
const BUNDLE_B64 = process.env.ORBIT_LIVE_VAULT_BUNDLE_B64;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readBundle() {
  if (!BUNDLE_B64?.trim()) fail("ORBIT_LIVE_VAULT_BUNDLE_B64 is required.");
  try {
    const raw = Buffer.from(BUNDLE_B64.trim(), "base64").toString("utf8");
    return JSON.parse(raw);
  } catch (error) {
    fail(`Unable to decode ORBIT_LIVE_VAULT_BUNDLE_B64: ${error?.message || error}`);
  }
}

function fileFromBundle(bundle, name, aliases = []) {
  const value = bundle.files?.[name]
    || aliases.map((alias) => bundle[alias]).find(Boolean);
  if (!value) fail(`Live vault bundle is missing ${name}.`);
  try {
    return Buffer.from(value, "base64");
  } catch (error) {
    fail(`Unable to decode ${name} from live vault bundle: ${error?.message || error}`);
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

if (!APP_DATA_DIR?.trim()) fail("ORBIT_APP_DATA_DIR is required.");
const appDataDir = path.resolve(APP_DATA_DIR);
const bundle = readBundle();
fs.mkdirSync(appDataDir, { recursive: true, mode: 0o700 });

writePrivateFile(
  path.join(appDataDir, "orbit_code.db"),
  fileFromBundle(bundle, "orbit_code.db", ["orbitCodeDbB64", "databaseB64", "dbB64"]),
);
writePrivateFile(
  path.join(appDataDir, "orbit-device-unlock.key"),
  fileFromBundle(bundle, "orbit-device-unlock.key", ["deviceKeyB64", "trustedDeviceKeyB64"]),
);

console.log(`Orbit live vault bundle installed into ${appDataDir}`);
