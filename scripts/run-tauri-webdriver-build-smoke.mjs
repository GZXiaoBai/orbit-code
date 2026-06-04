#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { timestampId, writeSmokeReport } from "./smoke-report.mjs";

const TAURI_WEBDRIVER_DOC = "https://v2.tauri.app/develop/tests/webdriver/";
const DEFAULT_TIMEOUT_MS = Number(process.env.ORBIT_DESKTOP_BUILD_TIMEOUT_MS || 120_000);
const REQUEST_TIMEOUT_MS = Number(process.env.ORBIT_WEBDRIVER_REQUEST_TIMEOUT_MS || 15_000);
const SESSION_TIMEOUT_MS = Number(process.env.ORBIT_WEBDRIVER_SESSION_TIMEOUT_MS || Math.max(DEFAULT_TIMEOUT_MS, 60_000));
const LIVE_BUILD_ENABLED = process.env.ORBIT_DESKTOP_BUILD_LIVE === "1";
const DENY_APPROVAL = process.env.ORBIT_DESKTOP_BUILD_DENY === "1";
const SMOKE_FILE = process.env.ORBIT_DESKTOP_BUILD_SMOKE_FILE || "ORBIT_DESKTOP_BUILD_SMOKE.md";
const APP_DATA_DIR = process.env.ORBIT_APP_DATA_DIR ? path.resolve(process.env.ORBIT_APP_DATA_DIR) : null;
const WORKSPACE_DIR = process.env.ORBIT_DESKTOP_BUILD_WORKSPACE
  ? path.resolve(process.env.ORBIT_DESKTOP_BUILD_WORKSPACE)
  : LIVE_BUILD_ENABLED
    ? path.resolve(".qa/desktop-build-workspace")
    : null;

function reportId() {
  return timestampId("tauri-webdriver-build-smoke");
}

function which(binary) {
  const result = spawnSync(process.platform === "win32" ? "where" : "which", [binary], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.split(/\r?\n/).find(Boolean)?.trim() || "" : "";
}

function criterion(id, label, status, message, evidence = {}) {
  return { id, label, status, message, evidence };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("Unable to allocate a local WebDriver port."));
      });
    });
  });
}

function discoverAppPath() {
  if (process.env.ORBIT_TAURI_APP_PATH) return path.resolve(process.env.ORBIT_TAURI_APP_PATH);
  const candidates = process.platform === "win32"
    ? ["src-tauri/target/debug/orbit-code.exe", "src-tauri/target/release/orbit-code.exe"]
    : ["src-tauri/target/debug/orbit-code", "src-tauri/target/release/orbit-code"];
  return candidates.map((candidate) => path.resolve(candidate)).find((candidate) => fs.existsSync(candidate)) || "";
}

async function requestJson(baseUrl, method, route, body, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    }).catch((error) => {
      if (error?.name === "AbortError") {
        throw new Error(`${method} ${route} timed out after ${timeoutMs}ms`);
      }
      throw error;
    });
    const text = await response.text();
    let json = null;
    if (text.trim()) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
    }
    if (!response.ok) throw new Error(`${method} ${route} returned ${response.status}: ${text.slice(0, 500)}`);
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForDriver(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      await requestJson(baseUrl, "GET", "/status");
      return;
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }
  throw new Error(`Timed out waiting for tauri-driver: ${lastError?.message || "no response"}`);
}

async function waitForTruthy(session, script, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastValue = null;
  while (Date.now() < deadline) {
    const result = await session.execute(script);
    lastValue = result?.value;
    if (lastValue) return lastValue;
    await sleep(300);
  }
  throw new Error(`Timed out waiting for WebDriver condition. Last value: ${JSON.stringify(lastValue)}`);
}

function prepareSmokeWorkspace(criteria) {
  if (!WORKSPACE_DIR || !LIVE_BUILD_ENABLED) return;
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  const readme = path.join(WORKSPACE_DIR, "README.md");
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, "# Orbit desktop Build smoke\n\nTemporary workspace for live desktop Build verification.\n");
  }
  const smokePath = path.join(WORKSPACE_DIR, SMOKE_FILE);
  fs.rmSync(smokePath, { force: true });
  criteria.push(criterion(
    "desktop-build-workspace-prepared",
    "Live Build smoke uses an isolated workspace.",
    "verified",
    "Prepared a temporary workspace and removed stale smoke output before launching Build.",
    { workspaceDir: WORKSPACE_DIR, smokeFile: SMOKE_FILE },
  ));
}

function cleanupSmokeWorkspace(criteria) {
  if (!WORKSPACE_DIR || !LIVE_BUILD_ENABLED) return;
  const smokePath = path.join(WORKSPACE_DIR, SMOKE_FILE);
  const existed = fs.existsSync(smokePath);
  fs.rmSync(smokePath, { force: true });
  criteria.push(criterion(
    "desktop-build-workspace-cleanup",
    "Live Build smoke cleans the temporary file it asks Codex to write.",
    "verified",
    existed
      ? "Removed the smoke file created by the approved Build run."
      : "No smoke file was present after the run.",
    { workspaceDir: WORKSPACE_DIR, smokeFile: SMOKE_FILE, existed },
  ));
}

async function configureWorkspace(session, criteria) {
  if (!WORKSPACE_DIR || !LIVE_BUILD_ENABLED) return;
  await session.execute(`
    window.localStorage.setItem("orbit-code.active-workspace.v1", ${JSON.stringify(WORKSPACE_DIR)});
    window.localStorage.removeItem("agent-gui.active-workspace.v1");
    window.location.reload();
    return true;
  `);
  await waitForTruthy(session, `
    const text = document.body.innerText || "";
    return text.includes(${JSON.stringify(WORKSPACE_DIR)}) || text.includes(${JSON.stringify(path.basename(WORKSPACE_DIR))});
  `, DEFAULT_TIMEOUT_MS);
  criteria.push(criterion(
    "desktop-build-workspace-loaded",
    "Packaged desktop window loads the isolated smoke workspace.",
    "verified",
    "The workbench rendered the smoke workspace after seeding Orbit's active workspace storage.",
    { workspaceDir: WORKSPACE_DIR },
  ));
}

function elementKey(element) {
  return element?.["element-6066-11e4-a52e-4f735466cecf"] || element?.ELEMENT;
}

async function createSession(baseUrl, appPath) {
  const response = await requestJson(baseUrl, "POST", "/session", {
    capabilities: {
      alwaysMatch: {
        browserName: "wry",
        "tauri:options": { application: appPath },
      },
    },
  }, SESSION_TIMEOUT_MS);
  const sessionId = response?.value?.sessionId || response?.sessionId;
  if (!sessionId) throw new Error(`tauri-driver did not return a session id: ${JSON.stringify(response)}`);
  return {
    id: sessionId,
    async execute(script, args = []) {
      return requestJson(baseUrl, "POST", `/session/${sessionId}/execute/sync`, { script, args });
    },
    async quit() {
      try {
        await requestJson(baseUrl, "DELETE", `/session/${sessionId}`);
      } catch {
        // The app may already be closed by the driver.
      }
    },
  };
}

function launchDriver(port) {
  const command = process.env.ORBIT_TAURI_DRIVER || "tauri-driver";
  return spawn(command, ["--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
}

async function verifyDesktopPrerequisites(criteria) {
  const platform = process.platform;
  if (platform === "darwin") {
    criteria.push(criterion(
      "desktop-webdriver-platform",
      "Host platform can drive the packaged Tauri window.",
      "blocked",
      "macOS cannot run Tauri WebDriver automation because WKWebView has no WebDriver implementation. Run this smoke on Linux/Windows CI.",
      { platform, docs: TAURI_WEBDRIVER_DOC },
    ));
    return null;
  }

  const tauriDriverPath = which(process.env.ORBIT_TAURI_DRIVER || "tauri-driver");
  if (!tauriDriverPath) {
    criteria.push(criterion("tauri-driver-binary", "tauri-driver is installed.", "broken", "Install tauri-driver before running the packaged-window Build smoke."));
    return null;
  }
  criteria.push(criterion("tauri-driver-binary", "tauri-driver is installed.", "verified", "tauri-driver found on PATH.", { path: tauriDriverPath }));

  if (platform === "linux") {
    const webkitDriverPath = which("WebKitWebDriver");
    if (!webkitDriverPath) {
      criteria.push(criterion("linux-webkit-driver", "Linux WebKitWebDriver is installed.", "broken", "Install webkit2gtk-driver before running the packaged-window Build smoke."));
      return null;
    }
    criteria.push(criterion("linux-webkit-driver", "Linux WebKitWebDriver is installed.", "verified", "WebKitWebDriver found on PATH.", { path: webkitDriverPath }));
  }

  const appPath = discoverAppPath();
  if (!appPath || !fs.existsSync(appPath)) {
    criteria.push(criterion("orbit-app-binary", "Orbit Code debug/release binary exists.", "broken", "Build the Tauri app first or set ORBIT_TAURI_APP_PATH to the application binary.", { appPath: appPath || null }));
    return null;
  }
  criteria.push(criterion("orbit-app-binary", "Orbit Code debug/release binary exists.", "verified", "Found a launchable Orbit Code binary.", { appPath }));
  return appPath;
}

async function submitBuildPrompt(session) {
  const prompt = [
    "Desktop Build live smoke:",
    `1. Create or overwrite ${SMOKE_FILE} with a short timestamped line.`,
    `2. Run a terminal command that prints ${SMOKE_FILE}.`,
    "3. Summarize the file edit and command result.",
  ].join("\n");

  await waitForTruthy(session, `
    return Boolean(document.querySelector(".composer textarea") && document.querySelector(".composer .send-button"));
  `, DEFAULT_TIMEOUT_MS);
  await session.execute(`
    const buildButton = [...document.querySelectorAll(".run-control-bar button")]
      .find((button) => /Build/i.test(button.textContent || ""));
    if (buildButton) buildButton.click();
    const textarea = document.querySelector(".composer textarea");
    const button = document.querySelector(".composer .send-button");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    setter.call(textarea, ${JSON.stringify(prompt)});
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: ${JSON.stringify(prompt)}, inputType: "insertText" }));
    button.click();
    return true;
  `);
}

async function runLiveBuild(session, criteria) {
  await waitForTruthy(session, `
    return Boolean(
      document.querySelector(".workbench-shell")
      || document.querySelector(".thread-canvas")
      || document.body.innerText.includes("Orbit Code")
    );
  `, DEFAULT_TIMEOUT_MS);
  criteria.push(criterion("workbench-visible", "Workbench shell is visible in the real Tauri window.", "verified", "The launched desktop window rendered Orbit Code's workbench shell."));

  if (!LIVE_BUILD_ENABLED) {
    criteria.push(criterion(
      "live-build-submit",
      "Build submit completes through the real desktop window.",
      "blocked",
      "Skipped because ORBIT_DESKTOP_BUILD_LIVE=1 is not set. This keeps CI independent from local vault/API credentials.",
      { denyApproval: DENY_APPROVAL },
    ));
    return "blocked";
  }

  prepareSmokeWorkspace(criteria);
  await configureWorkspace(session, criteria);
  await submitBuildPrompt(session);
  const preflight = await waitForTruthy(session, `
    const text = document.body.innerText || "";
    if (/Build blocked|Build 已阻止|Codex Build blocked|runtime is not ready|凭据库|vault|API key/i.test(text)) {
      return { blocked: true, text: text.slice(-1600) };
    }
    if (document.querySelector(".approval-dialog")) {
      return { approval: true, text: text.slice(-1600) };
    }
    return "";
  `, DEFAULT_TIMEOUT_MS);
  if (preflight.blocked) {
    criteria.push(criterion("build-gate", "Build is not allowed to enter a half-running state when prerequisites are missing.", "broken", "Build was blocked before approval.", preflight));
    return "broken";
  }
  criteria.push(criterion("approval-request", "Build produces a real approval request.", "verified", "Approval overlay appeared in the packaged desktop window."));

  await session.execute(`
    const dialog = document.querySelector(".approval-dialog");
    const button = [...dialog.querySelectorAll("button")]
      .find((candidate) => ${DENY_APPROVAL}
        ? /拒绝|Deny|Cancel/i.test(candidate.textContent || "")
        : /批准|Approve/i.test(candidate.textContent || ""));
    if (!button) throw new Error("Approval resolution button not found.");
    button.click();
    return true;
  `);

  if (DENY_APPROVAL) {
    await waitForTruthy(session, `
      const text = document.body.innerText || "";
      const hasDenied = /denied|拒绝|已拒绝|Denied by user/i.test(text);
      const hasTerminalOrEdit = Boolean(document.querySelector(".dock-terminal") || document.querySelector(".dock-diff-card"));
      return hasDenied && !hasTerminalOrEdit ? text.slice(-1600) : "";
    `, DEFAULT_TIMEOUT_MS);
    criteria.push(criterion("deny-path", "Denied approval does not produce terminal output or file edits.", "verified", "The packaged window reflected denial without terminal/fileEdit artifacts."));
    return "verified";
  }

  const evidence = await waitForTruthy(session, `
    const text = document.body.innerText || "";
    const terminal = document.querySelector(".dock-terminal")?.innerText || "";
    const edit = document.querySelector(".dock-diff-card")?.innerText || "";
    const hasTerminal = terminal.length > 0 || /Terminal|终端|command|命令/i.test(text);
    const hasEdit = edit.includes(${JSON.stringify(SMOKE_FILE)}) || text.includes(${JSON.stringify(SMOKE_FILE)});
    const hasUsage = /Token|tokens|usage|使用量|prompt=|completion=|total=/i.test(text);
    const hasFinalSummary = /final summary|summary|总结|完成|completed|created|updated|wrote|写入|已完成/i.test(text);
    return hasTerminal && hasEdit && hasUsage && hasFinalSummary
      ? { text: text.slice(-2400), terminal, edit, hasTerminal, hasEdit, hasUsage, hasFinalSummary }
      : "";
  `, DEFAULT_TIMEOUT_MS);
  criteria.push(criterion("approval-terminal", "Approved Build produces terminal output.", "verified", "The packaged window showed terminal evidence after approval.", { smokeFile: SMOKE_FILE, terminal: evidence.terminal }));
  criteria.push(criterion("approval-file-edit", "Approved Build produces a fileEdit item.", "verified", "The packaged window showed file edit evidence after approval.", { smokeFile: SMOKE_FILE, edit: evidence.edit }));
  criteria.push(criterion("approval-usage", "Approved Build produces usage evidence.", "verified", "The packaged window showed token usage evidence after approval.", { smokeFile: SMOKE_FILE }));
  criteria.push(criterion("approval-final-summary", "Approved Build produces a final assistant summary.", "verified", "The packaged window showed final assistant summary evidence after approval.", { smokeFile: SMOKE_FILE }));
  return "verified";
}

async function runSmoke(criteria) {
  const appPath = await verifyDesktopPrerequisites(criteria);
  if (!appPath) return criteria.some((item) => item.status === "broken") ? "broken" : "blocked";

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const driver = launchDriver(port);
  let session = null;
  const stderr = [];
  const stdout = [];
  driver.stdout.on("data", (chunk) => stdout.push(String(chunk)));
  driver.stderr.on("data", (chunk) => stderr.push(String(chunk)));

  try {
    await waitForDriver(baseUrl, DEFAULT_TIMEOUT_MS);
    session = await createSession(baseUrl, appPath);
    criteria.push(criterion("webdriver-session", "WebDriver can launch an Orbit Code desktop session.", "verified", "tauri-driver created a WRY session for Orbit Code.", { sessionId: session.id }));
    return await runLiveBuild(session, criteria);
  } catch (error) {
    criteria.push(criterion(
      "webdriver-build-run",
      "Packaged desktop Build smoke completes without runtime errors.",
      "broken",
      error?.message || String(error),
      { stdout: stdout.join("").slice(-4000), stderr: stderr.join("").slice(-4000) },
    ));
    return "broken";
  } finally {
    if (session) await session.quit();
    driver.kill("SIGTERM");
  }
}

async function main() {
  const startedAt = new Date().toISOString();
  const criteria = [];
  let result = "broken";
  try {
    result = await runSmoke(criteria);
  } catch (error) {
    criteria.push(criterion("desktop-build-smoke", "Packaged-window Build smoke runner completes.", "broken", error?.message || String(error)));
    result = "broken";
  } finally {
    cleanupSmokeWorkspace(criteria);
  }

  if (criteria.some((item) => item.status === "broken")) result = "broken";
  else if (criteria.some((item) => item.status === "blocked")) result = "blocked";
  else result = "verified";

  const report = {
    id: reportId(),
    scope: "Packaged-window Build smoke for Orbit Code through tauri-driver/WebDriver. Default mode verifies readiness; live Build requires ORBIT_DESKTOP_BUILD_LIVE=1.",
    startedAt,
    completedAt: new Date().toISOString(),
    result,
    liveBuildEnabled: LIVE_BUILD_ENABLED,
    denyApproval: DENY_APPROVAL,
    smokeFile: SMOKE_FILE,
    timeouts: {
      requestMs: REQUEST_TIMEOUT_MS,
      sessionMs: SESSION_TIMEOUT_MS,
      overallMs: DEFAULT_TIMEOUT_MS,
    },
    appDataOverride: APP_DATA_DIR ? { enabled: true, path: APP_DATA_DIR } : { enabled: false },
    workspace: WORKSPACE_DIR ? { path: WORKSPACE_DIR } : null,
    criteria,
  };
  writeSmokeReport("tauri-webdriver-build-smoke", report, "Tauri WebDriver Build smoke report");
  console.log(`Result: ${result}`);
  if (result === "broken") process.exit(1);
}

main();
