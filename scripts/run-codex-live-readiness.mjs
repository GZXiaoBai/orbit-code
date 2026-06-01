#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { timestampId, writeSmokeReport } from "./smoke-report.mjs";

const APP_SUPPORT = process.env.ORBIT_APP_DATA_DIR
  ? path.resolve(process.env.ORBIT_APP_DATA_DIR)
  : path.join(process.env.HOME || "", "Library/Application Support/com.zhoujunjie.orbitcode");
const DB_PATH = process.env.ORBIT_DB_PATH || path.join(APP_SUPPORT, "orbit_code.db");
const DEVICE_KEY_PATH = process.env.ORBIT_DEVICE_KEY_PATH || path.join(APP_SUPPORT, "orbit-device-unlock.key");
const MODEL = process.env.ORBIT_DEEPSEEK_SMOKE_MODEL || "deepseek-v4-flash";

function nowId(prefix) {
  return timestampId(prefix);
}

function criterion(id, label, ok, message, evidence = {}) {
  return {
    id,
    label,
    status: ok ? "verified" : "blocked",
    message,
    evidence,
  };
}

function runSql(sql) {
  return execFileSync("sqlite3", [DB_PATH, sql], { encoding: "utf8" }).trim();
}

function decryptTrustedDeviceVault() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`Orbit database not found at ${DB_PATH}`);
  }
  if (!fs.existsSync(DEVICE_KEY_PATH)) {
    throw new Error(`Trusted-device unlock key not found at ${DEVICE_KEY_PATH}`);
  }
  const rawEnvelope = runSql("select value from kv_store where key='credential.vault.auto_unlock';");
  if (!rawEnvelope) {
    throw new Error("Orbit credential vault auto-unlock is not enabled.");
  }
  const envelope = JSON.parse(rawEnvelope);
  const key = Buffer.from(fs.readFileSync(DEVICE_KEY_PATH, "utf8").trim(), "base64");
  const nonce = Buffer.from(envelope.nonce, "base64");
  const encrypted = Buffer.from(envelope.ciphertext, "base64");
  const ciphertext = encrypted.subarray(0, encrypted.length - 16);
  const tag = encrypted.subarray(encrypted.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}

function sidecarPathForHost() {
  const platform = process.platform;
  const arch = process.arch;
  const target = platform === "darwin" && arch === "arm64"
    ? "aarch64-apple-darwin"
    : platform === "darwin" && arch === "x64"
      ? "x86_64-apple-darwin"
      : platform === "linux" && arch === "x64"
        ? "x86_64-unknown-linux-gnu"
        : "";
  return target ? path.resolve("src-tauri/binaries", `codex-${target}`) : "";
}

function readSidecarVersion(binaryPath) {
  if (!binaryPath || !fs.existsSync(binaryPath)) return "";
  const result = spawnSync(binaryPath, ["--version"], { encoding: "utf8", timeout: 10_000 });
  return `${result.stdout || ""}${result.stderr || ""}`.trim();
}

async function checkDeepSeekModels(apiKey) {
  const response = await fetch("https://api.deepseek.com/v1/models", {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`DeepSeek /models failed with ${response.status}: ${body.slice(0, 240)}`);
  }
  const parsed = JSON.parse(body);
  const modelIds = Array.isArray(parsed.data)
    ? parsed.data.map((item) => item?.id).filter(Boolean)
    : [];
  return {
    count: modelIds.length,
    requestedModelListed: modelIds.includes(MODEL),
    sample: modelIds.slice(0, 8),
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const criteria = [];
  let apiKey = "";

  try {
    const vault = decryptTrustedDeviceVault();
    const providers = Object.keys(vault.providers || {});
    apiKey = vault.providers?.deepseek || "";
    criteria.push(criterion(
      "trusted-device-vault",
      "Trusted-device auto-unlock vault can be decrypted without exposing plaintext.",
      true,
      "Vault decrypted in process memory.",
      { providers },
    ));
    criteria.push(criterion(
      "deepseek-credential",
      "DeepSeek credential is present in the unlocked vault payload.",
      Boolean(apiKey),
      apiKey ? "DeepSeek credential present." : "DeepSeek credential missing.",
    ));
  } catch (error) {
    criteria.push(criterion(
      "trusted-device-vault",
      "Trusted-device auto-unlock vault can be decrypted without exposing plaintext.",
      false,
      error instanceof Error ? error.message : String(error),
      { dbPath: DB_PATH, deviceKeyPath: DEVICE_KEY_PATH },
    ));
  }

  const sidecarPath = sidecarPathForHost();
  const sidecarVersion = readSidecarVersion(sidecarPath);
  criteria.push(criterion(
    "prepared-sidecar",
    "Prepared Codex sidecar binary exists for this host.",
    Boolean(sidecarPath && fs.existsSync(sidecarPath)),
    sidecarPath && fs.existsSync(sidecarPath) ? "Prepared sidecar found." : "Run npm run prepare:codex-sidecar.",
    { path: sidecarPath || "unsupported-host", version: sidecarVersion || undefined },
  ));

  if (apiKey) {
    try {
      const models = await checkDeepSeekModels(apiKey);
      criteria.push(criterion(
        "deepseek-network",
        "DeepSeek API is reachable with the vault credential.",
        true,
        "DeepSeek /models returned successfully.",
        models,
      ));
    } catch (error) {
      criteria.push(criterion(
        "deepseek-network",
        "DeepSeek API is reachable with the vault credential.",
        false,
        error instanceof Error ? error.message : String(error),
      ));
    }
  } else {
    criteria.push(criterion(
      "deepseek-network",
      "DeepSeek API is reachable with the vault credential.",
      false,
      "Skipped because no DeepSeek credential was available.",
    ));
  }

  const completedAt = new Date().toISOString();
  const result = criteria.every((item) => item.status === "verified") ? "verified" : "blocked";
  const report = {
    id: nowId("codex-live-readiness"),
    runtime: "codex-sidecar.v1",
    provider: "deepseek",
    model: MODEL,
    scope: "Noninteractive readiness for a future live Codex app-server Build smoke. This verifies trusted-device vault availability, prepared sidecar presence, and DeepSeek network reachability without logging or persisting the API key.",
    startedAt,
    completedAt,
    result,
    criteria,
  };
  writeSmokeReport("codex-live-readiness", report, "Codex live readiness report");
  console.log(`Result: ${result}`);
  if (result !== "verified") process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
