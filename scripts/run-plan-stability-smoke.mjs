#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { timestampId, writeSmokeReport } from "./smoke-report.mjs";

function reportId() {
  return timestampId("plan-stability-smoke");
}

function runStep(id, label, npmScript) {
  const startedAt = new Date().toISOString();
  const result = spawnSync("npm", ["run", npmScript], {
    encoding: "utf8",
    env: process.env,
  });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  return {
    id,
    label,
    command: "npm",
    args: ["run", npmScript],
    status: result.status === 0 ? "verified" : "broken",
    startedAt,
    completedAt: new Date().toISOString(),
    exitCode: result.status,
    stdoutTail: (result.stdout || "").slice(-6000),
    stderrTail: (result.stderr || "").slice(-6000),
  };
}

function main() {
  const startedAt = new Date().toISOString();
  const steps = [
    runStep(
      "desktop-route-fixture",
      "Workbench Plan submit uses direct-deepseek-plan and does not preflight/restart Codex app-server.",
      "smoke:plan-route",
    ),
    runStep(
      "live-deepseek-sse",
      "DeepSeek direct Plan path can stream reasoning/content deltas from the Orbit vault credential.",
      "smoke:plan-live",
    ),
  ];
  const completedAt = new Date().toISOString();
  const result = steps.every((step) => step.status === "verified") ? "verified" : "broken";
  const report = {
    id: reportId(),
    runtime: "direct-deepseek-plan",
    provider: "deepseek",
    scope: "Combined Plan stability gate. This proves the frontend route does not touch Codex app-server after submit and the live DeepSeek SSE path can stream a simple greeting. It is not a packaged Tauri window WebDriver smoke.",
    startedAt,
    completedAt,
    result,
    steps,
    remainingGap: "Add tauri-driver/WebDriver or equivalent desktop automation to prove both checks inside the packaged Orbit Code window.",
  };
  writeSmokeReport("plan-stability-smoke", report, "Plan stability smoke report");
  console.log(`Result: ${result}`);
  if (result !== "verified") process.exit(1);
}

main();
