import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const binariesDir = path.join(repoRoot, "src-tauri", "binaries");
const pinPath = path.join(import.meta.dirname, "codex-sidecar-pin.json");

const targetByPlatform = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "win32-x64": "x86_64-pc-windows-msvc",
};

const npmVendorTargetByPlatform = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-musl",
  "linux-x64": "x86_64-unknown-linux-musl",
  "win32-x64": "x86_64-pc-windows-msvc",
};

function targetPlatformKey() {
  const key = `${process.platform}-${process.arch}`;
  if (!targetByPlatform[key]) {
    throw new Error(`Unsupported sidecar target platform: ${key}`);
  }
  return key;
}

function targetTriple() {
  const key = targetPlatformKey();
  const target = process.env.TAURI_TARGET_TRIPLE || process.env.TARGET || targetByPlatform[key];
  if (!target) {
    throw new Error(`Unsupported sidecar target platform: ${key}`);
  }
  return target;
}

function npmVendorCandidates(target, extension) {
  const platformKey = targetPlatformKey();
  const packageName = `codex-${platformKey}`;
  const vendorTarget = npmVendorTargetByPlatform[platformKey] ?? target;
  return [
    path.join(repoRoot, "node_modules", "@openai", packageName, "vendor", vendorTarget, "bin", `codex${extension}`),
  ];
}

function pathCandidates(target, extension) {
  const candidates = [
    process.env.ORBIT_CODEX_BINARY,
    process.env.CODEX_BINARY,
    ...npmVendorCandidates(target, extension),
    "/Applications/Codex.app/Contents/Resources/codex",
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    path.join(os.homedir(), ".local", "bin", "codex"),
    path.join(os.homedir(), ".cargo", "bin", "codex"),
  ].filter(Boolean);

  try {
    const found = execFileSync("sh", ["-lc", "command -v codex"], { encoding: "utf8" }).trim();
    if (found) candidates.push(found);
  } catch {
    // PATH lookup is best-effort; explicit app bundle and env paths cover packaged dev machines.
  }

  return [...new Set(candidates)];
}

function resolveCodexBinary(target, extension) {
  for (const candidate of pathCandidates(target, extension)) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  throw new Error(
    "Codex sidecar source binary not found. Set ORBIT_CODEX_BINARY to a pinned Codex binary before building Orbit."
  );
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function readPin() {
  if (!fs.existsSync(pinPath)) return null;
  return JSON.parse(fs.readFileSync(pinPath, "utf8"));
}

function verifyPinnedBinary(source, target) {
  const pin = readPin();
  if (!pin) return;
  const expectedSha = pin.sha256?.[target];
  if (expectedSha) {
    const actualSha = sha256(source);
    if (actualSha !== expectedSha) {
      throw new Error(`Codex sidecar checksum mismatch for ${target}. Expected ${expectedSha}, got ${actualSha}. Set ORBIT_CODEX_BINARY to the pinned binary or update scripts/codex-sidecar-pin.json intentionally.`);
    }
  }
  if (pin.version) {
    const actualVersion = execFileSync(source, ["--version"], { encoding: "utf8" }).trim();
    if (actualVersion !== pin.version) {
      throw new Error(`Codex sidecar version mismatch. Expected "${pin.version}", got "${actualVersion}".`);
    }
  }
}

function main() {
  const target = targetTriple();
  const extension = process.platform === "win32" ? ".exe" : "";
  const source = resolveCodexBinary(target, extension);
  const destination = path.join(binariesDir, `codex-${target}${extension}`);
  verifyPinnedBinary(source, target);

  fs.mkdirSync(binariesDir, { recursive: true });
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, 0o755);

  console.log(`Prepared Codex sidecar: ${destination}`);
}

main();
