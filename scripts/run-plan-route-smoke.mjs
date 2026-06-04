#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeSmokeReport } from "./smoke-report.mjs";

const TEST_FILE = "e2e/run-controls.spec.ts";
const TEST_NAME = "desktop Plan submission uses direct DeepSeek route without app-server preflight";

function run(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    env: process.env,
  });
}

function criterion(id, label, ok, evidence = {}) {
  return {
    id,
    label,
    status: ok ? "verified" : "broken",
    evidence,
  };
}

function main() {
  const startedAt = new Date().toISOString();
  const result = run("npx", ["playwright", "test", TEST_FILE, "-g", TEST_NAME]);
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");

  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const acceptanceCriteria = [
    criterion(
      "focused-e2e-ran",
      "Focused Playwright route test executed.",
      output.includes(TEST_NAME),
      { testFile: TEST_FILE, testName: TEST_NAME },
    ),
    criterion(
      "direct-plan-route",
      "Desktop Plan submit uses codex_turn_start with runtimeMode direct-deepseek-plan.",
      result.status === 0,
      { command: "codex_turn_start", runtimeMode: "direct-deepseek-plan" },
    ),
    criterion(
      "no-app-server-preflight",
      "Desktop Plan submit does not call codex_sidecar_status or codex_runtime_restart after send.",
      result.status === 0,
      { blockedCommands: ["codex_sidecar_status", "codex_runtime_restart"] },
    ),
  ];
  const completedAt = new Date().toISOString();
  const passed = result.status === 0 && acceptanceCriteria.every((item) => item.status === "verified");
  const report = {
    id: `plan-route-smoke-${completedAt.replace(/[:.]/g, "-")}`,
    runtime: "codex-sidecar.v1",
    provider: "deepseek",
    scope: "Focused workbench smoke for ordinary Plan/chat submissions. It verifies the desktop invoke route sends direct-deepseek-plan to codex_turn_start and does not preflight or restart Codex app-server after submit.",
    startedAt,
    completedAt,
    result: passed ? "verified" : "broken",
    acceptanceCriteria,
    step: {
      command: "npx",
      args: ["playwright", "test", TEST_FILE, "-g", TEST_NAME],
      status: result.status,
      stdoutTail: (result.stdout || "").slice(-6000),
      stderrTail: (result.stderr || "").slice(-6000),
    },
  };
  writeSmokeReport("plan-route-smoke", report, "Plan route smoke report");
  if (!passed) process.exit(1);
}

main();
