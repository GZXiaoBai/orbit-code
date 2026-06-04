#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { timestampId, writeSmokeReport } from "./smoke-report.mjs";

const TAURI_WEBDRIVER_DOC = "https://v2.tauri.app/develop/tests/webdriver/";
const DEFAULT_TIMEOUT_MS = Number(process.env.ORBIT_DESKTOP_PLAN_TIMEOUT_MS || 45_000);
const REQUEST_TIMEOUT_MS = Number(process.env.ORBIT_WEBDRIVER_REQUEST_TIMEOUT_MS || 15_000);
const SESSION_TIMEOUT_MS = Number(process.env.ORBIT_WEBDRIVER_SESSION_TIMEOUT_MS || Math.max(DEFAULT_TIMEOUT_MS, 60_000));
const LIVE_PLAN_ENABLED = process.env.ORBIT_DESKTOP_PLAN_LIVE === "1";

function reportId() {
  return timestampId("tauri-webdriver-plan-smoke");
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
  if (process.env.ORBIT_TAURI_APP_PATH) {
    return path.resolve(process.env.ORBIT_TAURI_APP_PATH);
  }
  const candidates = process.platform === "win32"
    ? [
      "src-tauri/target/debug/orbit-code.exe",
      "src-tauri/target/release/orbit-code.exe",
    ]
    : [
      "src-tauri/target/debug/orbit-code",
      "src-tauri/target/release/orbit-code",
    ];
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
    if (!response.ok) {
      throw new Error(`${method} ${route} returned ${response.status}: ${text.slice(0, 500)}`);
    }
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
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const result = await session.execute(script);
      lastValue = result?.value;
      lastError = null;
      if (lastValue) return lastValue;
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  const suffix = lastError ? ` Last execute error: ${lastError?.message || String(lastError)}` : "";
  throw new Error(`Timed out waiting for WebDriver condition. Last value: ${JSON.stringify(lastValue)}.${suffix}`);
}

async function captureDesktopDiagnostics(session) {
  if (!session) return null;
  try {
    const result = await session.execute(`
      const selectors = [".workbench-shell", ".thread-canvas", ".composer textarea", ".send-button", "#root"];
      return {
        readyState: document.readyState,
        url: window.location.href,
        title: document.title,
        bodyText: (document.body?.innerText || "").slice(0, 2000),
        bodyHtml: (document.body?.innerHTML || "").slice(0, 2000),
        selectors: Object.fromEntries(selectors.map((selector) => [selector, Boolean(document.querySelector(selector))])),
        rootChildren: document.getElementById("root")?.children.length ?? null,
      };
    `);
    return result?.value ?? null;
  } catch (error) {
    return { error: error?.message || String(error) };
  }
}

function elementKey(element) {
  return element?.["element-6066-11e4-a52e-4f735466cecf"] || element?.ELEMENT;
}

async function createSession(baseUrl, appPath) {
  const response = await requestJson(baseUrl, "POST", "/session", {
    capabilities: {
      alwaysMatch: {
        browserName: "wry",
        "tauri:options": {
          application: appPath,
        },
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
    async find(selector) {
      const result = await requestJson(baseUrl, "POST", `/session/${sessionId}/element`, {
        using: "css selector",
        value: selector,
      });
      return elementKey(result?.value);
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

async function runSmoke(criteria) {
  const platform = process.platform;
  if (platform === "darwin") {
    criteria.push(criterion(
      "desktop-webdriver-platform",
      "Host platform can drive the packaged Tauri window.",
      "blocked",
      "macOS cannot run Tauri WebDriver automation because WKWebView has no WebDriver implementation. Run this smoke on Linux/Windows CI.",
      { platform, docs: TAURI_WEBDRIVER_DOC },
    ));
    return "blocked";
  }

  const tauriDriverPath = which(process.env.ORBIT_TAURI_DRIVER || "tauri-driver");
  if (!tauriDriverPath) {
    criteria.push(criterion(
      "tauri-driver-binary",
      "tauri-driver is installed.",
      "broken",
      "Install tauri-driver before running the packaged-window Plan smoke.",
    ));
    return "broken";
  }
  criteria.push(criterion(
    "tauri-driver-binary",
    "tauri-driver is installed.",
    "verified",
    "tauri-driver found on PATH.",
    { path: tauriDriverPath },
  ));

  if (platform === "linux") {
    const webkitDriverPath = which("WebKitWebDriver");
    if (!webkitDriverPath) {
      criteria.push(criterion(
        "linux-webkit-driver",
        "Linux WebKitWebDriver is installed.",
        "broken",
        "Install webkit2gtk-driver before running the packaged-window Plan smoke.",
      ));
      return "broken";
    }
    criteria.push(criterion(
      "linux-webkit-driver",
      "Linux WebKitWebDriver is installed.",
      "verified",
      "WebKitWebDriver found on PATH.",
      { path: webkitDriverPath },
    ));
  }

  const appPath = discoverAppPath();
  if (!appPath || !fs.existsSync(appPath)) {
    criteria.push(criterion(
      "orbit-app-binary",
      "Orbit Code debug/release binary exists.",
      "broken",
      "Build the Tauri app first or set ORBIT_TAURI_APP_PATH to the application binary.",
      { appPath: appPath || null },
    ));
    return "broken";
  }
  criteria.push(criterion(
    "orbit-app-binary",
    "Orbit Code debug/release binary exists.",
    "verified",
    "Found a launchable Orbit Code binary.",
    { appPath },
  ));

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
    criteria.push(criterion(
      "webdriver-session",
      "WebDriver can launch an Orbit Code desktop session.",
      "verified",
      "tauri-driver created a WRY session for Orbit Code.",
      { sessionId: session.id },
    ));

    await waitForTruthy(session, `
      return Boolean(
        document.querySelector(".workbench-shell")
        || document.querySelector(".thread-canvas")
        || document.body.innerText.includes("Orbit Code")
      );
    `, DEFAULT_TIMEOUT_MS);
    criteria.push(criterion(
      "workbench-visible",
      "Workbench shell is visible in the real Tauri window.",
      "verified",
      "The launched desktop window rendered Orbit Code's workbench shell.",
    ));

    if (!LIVE_PLAN_ENABLED) {
      criteria.push(criterion(
        "live-plan-submit",
        "Plan submit streams through the real desktop window.",
        "blocked",
        "Skipped because ORBIT_DESKTOP_PLAN_LIVE=1 is not set. This keeps CI independent from local vault/API credentials.",
      ));
      return "blocked";
    }

    const composerExists = await waitForTruthy(session, `
      return Boolean(document.querySelector(".composer textarea") && document.querySelector(".composer .send-button"));
    `, DEFAULT_TIMEOUT_MS);
    if (!composerExists) throw new Error("Composer is not visible.");

    await session.execute(`
      const textarea = document.querySelector(".composer textarea");
      const button = document.querySelector(".composer .send-button");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      setter.call(textarea, "你好");
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: "你好", inputType: "insertText" }));
      button.click();
      return true;
    `);
    await waitForTruthy(session, `
      const text = document.querySelector(".agent-collaboration-timeline")?.innerText || document.body.innerText || "";
      const hasReply = /Assistant|Codex|推理|Reasoning/.test(text) && !/Codex app-server initialize|No active Codex app-server|thread\\/start response/.test(text);
      return hasReply ? text.slice(-1000) : "";
    `, DEFAULT_TIMEOUT_MS);
    criteria.push(criterion(
      "live-plan-submit",
      "Plan submit streams through the real desktop window.",
      "verified",
      "The real desktop window accepted a Plan message without app-server errors.",
    ));
    return "verified";
  } catch (error) {
    const diagnostics = await captureDesktopDiagnostics(session);
    criteria.push(criterion(
      "webdriver-run",
      "WebDriver desktop smoke completes without runtime errors.",
      "broken",
      error?.message || String(error),
      {
        stdout: stdout.join("").slice(-4000),
        stderr: stderr.join("").slice(-4000),
        diagnostics,
      },
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
    criteria.push(criterion(
      "desktop-plan-smoke",
      "Packaged-window Plan smoke runner completes.",
      "broken",
      error?.message || String(error),
    ));
    result = "broken";
  }

  if (criteria.some((item) => item.status === "broken")) result = "broken";
  else if (criteria.some((item) => item.status === "blocked")) result = "blocked";
  else result = "verified";

  const report = {
    id: reportId(),
    scope: "Packaged-window smoke for Orbit Code through tauri-driver/WebDriver. Default mode verifies launch and workbench render; live Plan submit requires ORBIT_DESKTOP_PLAN_LIVE=1.",
    startedAt,
    completedAt: new Date().toISOString(),
    result,
    livePlanEnabled: LIVE_PLAN_ENABLED,
    timeouts: {
      requestMs: REQUEST_TIMEOUT_MS,
      sessionMs: SESSION_TIMEOUT_MS,
      overallMs: DEFAULT_TIMEOUT_MS,
    },
    criteria,
  };
  writeSmokeReport("tauri-webdriver-plan-smoke", report, "Tauri WebDriver Plan smoke report");
  console.log(`Result: ${result}`);
  if (result === "broken") process.exit(1);
}

main();
