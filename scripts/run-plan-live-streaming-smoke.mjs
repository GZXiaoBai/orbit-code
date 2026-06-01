#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { timestampId, writeSmokeReport } from "./smoke-report.mjs";

const APP_SUPPORT = process.env.ORBIT_APP_DATA_DIR
  ? path.resolve(process.env.ORBIT_APP_DATA_DIR)
  : path.join(process.env.HOME || "", "Library/Application Support/com.zhoujunjie.orbitcode");
const DB_PATH = process.env.ORBIT_DB_PATH || path.join(APP_SUPPORT, "orbit_code.db");
const DEVICE_KEY_PATH = process.env.ORBIT_DEVICE_KEY_PATH || path.join(APP_SUPPORT, "orbit-device-unlock.key");
const MODEL = process.env.ORBIT_DEEPSEEK_PLAN_MODEL
  || process.env.ORBIT_DEEPSEEK_SMOKE_MODEL
  || "deepseek-v4-flash";
const TIMEOUT_MS = Number(process.env.ORBIT_PLAN_LIVE_SMOKE_TIMEOUT_MS || 60_000);

function reportId() {
  return timestampId("plan-live-streaming");
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

function safeSnippet(text) {
  return text.replace(/\s+/g, " ").trim().slice(0, 180);
}

async function runDeepSeekPlanStream(apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
  const evidence = {
    status: 0,
    frames: 0,
    assistantDeltas: 0,
    reasoningDeltas: 0,
    assistantChars: 0,
    reasoningChars: 0,
    completed: false,
    usage: null,
    assistantPreview: "",
  };
  let assistantText = "";
  let reasoningText = "";

  try {
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          {
            role: "system",
            content: "You are Orbit Code's planning assistant. Answer directly in Chinese.",
          },
          { role: "user", content: "你好" },
        ],
      }),
    });
    evidence.status = response.status;
    if (!response.ok || !response.body) {
      const body = await response.text().catch(() => "");
      throw new Error(`DeepSeek streaming request failed with ${response.status}: ${body.slice(0, 300)}`);
    }

    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === "[DONE]") {
          evidence.completed = true;
          continue;
        }
        evidence.frames += 1;
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        if (parsed.usage) {
          evidence.usage = {
            prompt_tokens: parsed.usage.prompt_tokens || 0,
            completion_tokens: parsed.usage.completion_tokens || 0,
            total_tokens: parsed.usage.total_tokens || 0,
          };
        }
        const delta = parsed.choices?.[0]?.delta || {};
        if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
          evidence.reasoningDeltas += 1;
          reasoningText += delta.reasoning_content;
        }
        if (typeof delta.content === "string" && delta.content) {
          evidence.assistantDeltas += 1;
          assistantText += delta.content;
        }
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  evidence.assistantChars = assistantText.length;
  evidence.reasoningChars = reasoningText.length;
  evidence.assistantPreview = safeSnippet(assistantText);
  return evidence;
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
      "Trusted-device vault decrypts locally without logging plaintext credentials.",
      true,
      "Vault decrypted in process memory.",
      { providers },
    ));
    criteria.push(criterion(
      "deepseek-credential",
      "DeepSeek credential exists in the unlocked vault.",
      Boolean(apiKey),
      apiKey ? "DeepSeek credential present." : "DeepSeek credential missing.",
    ));
  } catch (error) {
    criteria.push(criterion(
      "trusted-device-vault",
      "Trusted-device vault decrypts locally without logging plaintext credentials.",
      false,
      error instanceof Error ? error.message : String(error),
      { dbPath: DB_PATH, deviceKeyPath: DEVICE_KEY_PATH },
    ));
  }

  if (apiKey) {
    try {
      const stream = await runDeepSeekPlanStream(apiKey);
      criteria.push(criterion(
        "deepseek-plan-stream",
        "DeepSeek direct Plan chat returns SSE deltas for a simple greeting.",
        stream.status === 200 && stream.frames > 0 && stream.assistantChars > 0 && stream.completed,
        stream.assistantChars > 0
          ? "Received incremental assistant content from DeepSeek."
          : "DeepSeek stream completed without assistant text.",
        stream,
      ));
    } catch (error) {
      criteria.push(criterion(
        "deepseek-plan-stream",
        "DeepSeek direct Plan chat returns SSE deltas for a simple greeting.",
        false,
        error instanceof Error ? error.message : String(error),
        { model: MODEL },
      ));
    }
  } else {
    criteria.push(criterion(
      "deepseek-plan-stream",
      "DeepSeek direct Plan chat returns SSE deltas for a simple greeting.",
      false,
      "Skipped because no DeepSeek credential was available.",
      { model: MODEL },
    ));
  }

  const completedAt = new Date().toISOString();
  const result = criteria.every((item) => item.status === "verified") ? "verified" : "blocked";
  const report = {
    id: reportId(),
    runtime: "direct-deepseek-plan",
    provider: "deepseek",
    model: MODEL,
    scope: "Live noninteractive smoke for the ordinary Plan/chat path. It decrypts the Orbit trusted-device vault in memory, calls DeepSeek chat streaming directly, verifies SSE deltas, and never logs or persists the API key.",
    startedAt,
    completedAt,
    result,
    criteria,
  };
  writeSmokeReport("plan-live-streaming", report, "Plan live streaming report");
  console.log(`Result: ${result}`);
  if (result !== "verified") process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
