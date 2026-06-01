#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeSmokeReport } from "./smoke-report.mjs";

const CARGO_MANIFEST = "src-tauri/Cargo.toml";
const TEST_FILTER = "commands::codex::tests::responses_bridge_translates_deepseek_payload_and_items";

function runCargoSmoke() {
  return spawnSync("cargo", ["test", "--manifest-path", CARGO_MANIFEST, TEST_FILTER, "--", "--nocapture"], {
    encoding: "utf8",
    env: process.env,
  });
}

function main() {
  const startedAt = new Date().toISOString();
  const result = runCargoSmoke();
  const completedAt = new Date().toISOString();
  const passed = result.status === 0;
  const report = {
    id: `codex-bridge-deepseek-smoke-${completedAt.replace(/[:.]/g, "-")}`,
    runtime: "codex-sidecar.v1",
    provider: "deepseek",
    scope: "Codex Responses bridge translation and item mapping",
    command: `cargo test --manifest-path ${CARGO_MANIFEST} ${TEST_FILTER} -- --nocapture`,
    startedAt,
    completedAt,
    result: passed ? "verified" : "broken",
    note: "Bridge translation unit smoke. The default npm run smoke:deepseek now prepares the pinned sidecar and runs Codex app-server routing contract tests.",
    stdoutTail: (result.stdout || "").slice(-6000),
    stderrTail: (result.stderr || "").slice(-6000),
  };
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  writeSmokeReport("codex-bridge-deepseek-smoke", report, "Codex bridge smoke report");
  if (!passed) process.exit(result.status || 1);
}

main();
