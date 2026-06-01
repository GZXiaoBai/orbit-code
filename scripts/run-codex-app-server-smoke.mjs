#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeSmokeReport } from "./smoke-report.mjs";

function run(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    env: process.env,
  });
}

function outputFor(results, stepName) {
  const step = results.find((result) => result.name === stepName);
  return `${step?.stdoutTail || ""}\n${step?.stderrTail || ""}`;
}

function criterion(id, label, evidence, haystack) {
  const missing = evidence.filter((needle) => !haystack.includes(needle));
  return {
    id,
    label,
    status: missing.length === 0 ? "verified" : "broken",
    evidence,
    missing,
  };
}

function buildAcceptance(results) {
  const prepareOutput = outputFor(results, "prepare-sidecar");
  const rustOutput = outputFor(results, "codex-runtime-tests");
  const frontendOutput = outputFor(results, "frontend-codex-evidence");
  return [
    criterion(
      "sidecar-prepared",
      "Pinned Codex sidecar is prepared before smoke assertions run.",
      ["Prepared Codex sidecar"],
      prepareOutput,
    ),
    criterion(
      "persistent-app-server-routing",
      "Persistent app-server routing, request multiplexing, stale pending cleanup, and stderr diagnostics are covered.",
      [
        "json_rpc_client_multiplexes_responses_and_notifications",
        "persistent_request_without_stdin_cleans_pending_state",
        "persistent_response_timeout_cleans_runtime_state",
        "sidecar_stderr_tail_is_trimmed_and_attached_to_failures",
      ],
      rustOutput,
    ),
    criterion(
      "approval-and-tool-call-bridge",
      "DeepSeek Responses bridge can surface Codex approval/tool-call items.",
      [
        "responses_bridge_translates_deepseek_payload_and_items",
        "app_server_items_map_to_codex_events_and_review_patches",
      ],
      rustOutput,
    ),
    criterion(
      "terminal-and-file-edit-inspector",
      "Frontend Codex projection exposes terminal output and file edits to the workbench inspector.",
      [
        "maps Codex approval and terminal items into action and run-step models",
        "builds Codex inspector sections for denied approvals, answered questions, edits, and usage",
      ],
      frontendOutput,
    ),
    criterion(
      "final-summary-smoke-stage",
      "DeepSeek smoke harness requires the full typed Build loop including final summary.",
      [
        "passes when the full typed DeepSeek loop is present",
        "returns a failure ledger record for the first missing stage",
      ],
      frontendOutput,
    ),
    criterion(
      "build-runtime-preflight",
      "Workbench blocks Build before turn/start when the Codex app-server runtime is not ready.",
      [
        "blocks Build before turn/start when the app-server runtime is not ready",
        "treats a running app-server as ready even when Build will later emit turn items",
      ],
      frontendOutput,
    ),
  ];
}

function main() {
  const startedAt = new Date().toISOString();
  const steps = [
    {
      name: "prepare-sidecar",
      command: "npm",
      args: ["run", "prepare:codex-sidecar"],
    },
    {
      name: "codex-runtime-tests",
      command: "cargo",
      args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "commands::codex::tests::", "--", "--nocapture"],
    },
    {
      name: "frontend-codex-evidence",
      command: "npx",
      args: [
        "vitest",
        "run",
        "--reporter",
        "verbose",
        "src/__tests__/codexSessionRouting.test.ts",
        "src/__tests__/codexItemProjection.test.ts",
        "src/__tests__/deepSeekSmokeHarness.test.ts",
      ],
    },
  ];
  const results = [];
  for (const step of steps) {
    const result = run(step.command, step.args);
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    results.push({
      ...step,
      status: result.status,
      stdoutTail: (result.stdout || "").slice(-6000),
      stderrTail: (result.stderr || "").slice(-6000),
    });
    if (result.status !== 0) break;
  }
  const completedAt = new Date().toISOString();
  const acceptanceCriteria = buildAcceptance(results);
  const passed = results.length === steps.length
    && results.every((result) => result.status === 0)
    && acceptanceCriteria.every((item) => item.status === "verified");
  const report = {
    id: `codex-app-server-deepseek-smoke-${completedAt.replace(/[:.]/g, "-")}`,
    runtime: "codex-sidecar.v1",
    provider: "deepseek",
    scope: "Prepared Codex sidecar plus persistent Codex app-server routing, bridge approval/tool-call mapping, terminal/fileEdit projection, and final-summary smoke harness evidence. Live DeepSeek Build still requires an unlocked Orbit vault in the desktop runtime.",
    startedAt,
    completedAt,
    result: passed ? "verified" : "broken",
    acceptanceCriteria,
    steps: results,
  };
  writeSmokeReport("codex-app-server-deepseek-smoke", report, "Codex app-server smoke report");
  if (!passed) process.exit(1);
}

main();
