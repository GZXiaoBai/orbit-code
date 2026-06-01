#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { timestampId, writeSmokeReport } from "./smoke-report.mjs";

const TAURI_WEBDRIVER_DOC = "https://v2.tauri.app/develop/tests/webdriver/";

function reportId() {
  return timestampId("tauri-webdriver-readiness");
}

function which(binary) {
  const result = spawnSync("which", [binary], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function criterion(id, label, status, message, evidence = {}) {
  return { id, label, status, message, evidence };
}

function main() {
  const startedAt = new Date().toISOString();
  const criteria = [];
  const platform = process.platform;
  const tauriCli = spawnSync("npm", ["exec", "--", "tauri", "--version"], {
    encoding: "utf8",
  });
  const tauriDriverPath = which("tauri-driver");
  const webkitDriverPath = which("WebKitWebDriver");
  const edgeDriverPath = which("msedgedriver");

  criteria.push(criterion(
    "tauri-cli",
    "Tauri CLI is available for building and launching Orbit Code.",
    tauriCli.status === 0 ? "verified" : "broken",
    tauriCli.status === 0 ? "Tauri CLI responded." : "Tauri CLI is not available.",
    {
      stdout: (tauriCli.stdout || "").trim(),
      stderr: (tauriCli.stderr || "").trim(),
    },
  ));

  if (platform === "darwin") {
    criteria.push(criterion(
      "desktop-webdriver-platform",
      "Host platform can run Tauri desktop WebDriver automation.",
      "blocked",
      "macOS cannot run Tauri desktop WebDriver automation because there is no WKWebView driver. Use Linux/Windows CI for tauri-driver coverage, or add a separate macOS accessibility smoke.",
      { platform, docs: TAURI_WEBDRIVER_DOC },
    ));
  } else {
    criteria.push(criterion(
      "desktop-webdriver-platform",
      "Host platform can run Tauri desktop WebDriver automation.",
      "verified",
      "Host platform can use tauri-driver if the binary is installed.",
      { platform, docs: TAURI_WEBDRIVER_DOC },
    ));
  }

  if (platform === "darwin") {
    criteria.push(criterion(
      "tauri-driver-binary",
      "tauri-driver binary is installed.",
      "blocked",
      "Skipped on macOS because desktop WebDriver automation is not supported here.",
      { path: tauriDriverPath || null },
    ));
  } else {
    criteria.push(criterion(
      "tauri-driver-binary",
      "tauri-driver binary is installed.",
      tauriDriverPath ? "verified" : "broken",
      tauriDriverPath ? "tauri-driver found on PATH." : "Install tauri-driver before running packaged-window WebDriver smoke.",
      { path: tauriDriverPath || null },
    ));
  }

  if (platform === "linux") {
    criteria.push(criterion(
      "linux-webkit-driver",
      "Linux WebKitWebDriver is installed for Tauri WebDriver automation.",
      webkitDriverPath ? "verified" : "broken",
      webkitDriverPath ? "WebKitWebDriver found on PATH." : "Install webkit2gtk-driver before running desktop WebDriver smoke.",
      { path: webkitDriverPath || null },
    ));
  }

  if (platform === "win32") {
    criteria.push(criterion(
      "windows-edge-driver",
      "Windows Edge WebDriver is installed for Tauri WebDriver automation.",
      edgeDriverPath ? "verified" : "broken",
      edgeDriverPath ? "msedgedriver found on PATH." : "Install msedgedriver before running desktop WebDriver smoke.",
      { path: edgeDriverPath || null },
    ));
  }

  const completedAt = new Date().toISOString();
  const result = criteria.some((item) => item.status === "broken")
    ? "broken"
    : criteria.some((item) => item.status === "blocked")
      ? "blocked"
      : "verified";
  const report = {
    id: reportId(),
    scope: "Readiness check for a future packaged Orbit Code window smoke driven by tauri-driver/WebDriver.",
    startedAt,
    completedAt,
    result,
    criteria,
  };
  writeSmokeReport("tauri-webdriver-readiness", report, "Tauri WebDriver readiness report");
  console.log(`Result: ${result}`);
  if (result === "broken") process.exit(1);
}

main();
