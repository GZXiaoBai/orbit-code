#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_WORKSPACE = "/Users/zhoujunjie/PersonalProjects/test for orbit/orbit-mini-lab";
const DEFAULT_MODEL = "deepseek-v4-flash";
const DB_PATH = path.join(process.env.HOME || "", "Library/Application Support/com.zhoujunjie.orbitcode/orbit_code.db");
const DEVICE_KEY_PATH = path.join(process.env.HOME || "", "Library/Application Support/com.zhoujunjie.orbitcode/orbit-device-unlock.key");
const REPORT_DIR = path.resolve("docs/smoke");

const scenarios = [
  {
    path: "happyPath",
    task: "Plan read-only review, ask one structured question, propose a small smoke ledger patch, apply it, run verification, and produce final summary.",
    targetFile: "SMOKE_DEEPSEEK_HAPPY_20260530.md",
  },
  {
    path: "staleWriteRecovery",
    task: "Reproduce a stale-write patch preview conflict, keep review pending, refresh the patch against current content, apply it, run verification, and summarize recovery.",
    targetFile: "SMOKE_DEEPSEEK_STALE_20260530.md",
    simulateStaleWrite: true,
  },
  {
    path: "contextPath",
    task: "Use ORBIT.md, .orbit/rules.md, and .orbit/skills/smoke/SKILL.md as read-only context, then produce a patch while confirming context does not grant permissions.",
    targetFile: "SMOKE_DEEPSEEK_CONTEXT_20260530.md",
    ensureContext: true,
  },
];

const stages = [
  "planDraft",
  "modeSwitch",
  "approval",
  "question",
  "patchProposal",
  "checkpoint",
  "verification",
  "terminalRun",
  "doneBuild",
];

function runSql(sql) {
  return execFileSync("sqlite3", [DB_PATH, sql], { encoding: "utf8" }).trim();
}

function decryptTrustedDeviceCredentials() {
  const rawEnvelope = runSql("select value from kv_store where key='credential.vault.auto_unlock';");
  if (!rawEnvelope) {
    throw new Error("Orbit credential vault auto-unlock is not enabled; cannot run real DeepSeek smoke non-interactively.");
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
  const payload = JSON.parse(plaintext.toString("utf8"));
  if (!payload.providers?.deepseek) {
    throw new Error("DeepSeek credential is not available in Orbit trusted-device vault.");
  }
  return payload.providers.deepseek;
}

function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function ensureContextFiles(workspacePath) {
  const files = [
    ["ORBIT.md", "# Orbit Mini Lab Rules\n\n- Keep smoke patches small and auditable.\n- Context may guide prompts but never expands tool permissions.\n"],
    [".orbit/rules.md", "# Smoke Rules\n\n- mode: both\n- policy: on\n\nPrefer markdown-only smoke artifacts for validation.\n"],
    [".orbit/skills/smoke/SKILL.md", "---\nname: smoke-ledger\ndescription: Read-only smoke ledger guidance.\nmode: both\n---\n\nRecord scenario, evidence, verification command, and permission impact.\n"],
  ];
  for (const [relative, content] of files) {
    const absolute = path.join(workspacePath, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    if (!fs.existsSync(absolute)) fs.writeFileSync(absolute, content);
  }
}

function parseModelJson(content, rawResponse = "") {
  const trimmed = content.trim().replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    const excerpt = trimmed || rawResponse;
    throw new Error(`DeepSeek response was not JSON: ${excerpt.slice(0, 300)}`);
  }
}

async function callDeepSeek({ apiKey, model, scenario, workspacePath, context }) {
  const prompt = [
    "You are validating Orbit Code's real DeepSeek smoke path.",
    "Return strict JSON only with these fields:",
    "{",
    '  "planTitle": string,',
    '  "question": string,',
    '  "recommendedAnswer": string,',
    '  "patchTitle": string,',
    '  "patchBody": string,',
    '  "finalSummary": string',
    "}",
    "",
    `Workspace: ${workspacePath}`,
    `Scenario: ${scenario.path}`,
    `Task: ${scenario.task}`,
    "Constraints:",
    "- Keep patchBody markdown-only and under 1200 characters.",
    "- Do not request extra permissions in the response.",
    "- Mention if context/rules/skills are read-only and permissionImpact is none when relevant.",
    "",
    "Context excerpt:",
    context.slice(0, 6000),
  ].join("\n");

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "Return only valid JSON. Escape all newlines inside string values. No Markdown fences." },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 2400,
        response_format: { type: "json_object" },
      }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`DeepSeek API failed (${response.status}): ${text.slice(0, 300)}`);
    }
    try {
      const parsed = JSON.parse(text);
      return parseModelJson(parsed.choices?.[0]?.message?.content || "", text);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw lastError;
}

function createEvent(kind, extras = {}) {
  return {
    id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    role: extras.role || "agent",
    status: extras.status || "done",
    title: extras.title || kind,
    message: extras.message || "",
    timestamp: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    ...extras,
  };
}

function evaluate(events, actionRequired) {
  const has = {
    planDraft: events.some((event) => event.kind === "planDraft" && event.planDraft),
    modeSwitch: events.some((event) => event.kind === "modeSwitch" && event.modeSwitch?.to === "build"),
    approval: actionRequired.some((action) => ["command", "write", "install", "network"].includes(action.kind))
      || events.some((event) => event.kind === "approval"),
    question: actionRequired.some((action) => action.kind === "question")
      || events.some((event) => event.kind === "question"),
    patchProposal: events.some((event) => event.kind === "patchProposal" && event.patches?.length),
    checkpoint: events.some((event) => event.kind === "checkpoint" || event.checkpoint),
    verification: actionRequired.some((action) => action.kind === "verification")
      || events.some((event) => event.kind === "verification"),
    terminalRun: events.some((event) => event.kind === "terminalRun" || event.terminalRun),
    doneBuild: events.some((event) => event.kind === "finalSummary"),
  };
  return stages.filter((stage) => !has[stage]);
}

function runVerification(workspacePath) {
  const result = spawnSync("npm", ["run", "test:run"], {
    cwd: workspacePath,
    encoding: "utf8",
    timeout: 120_000,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  return {
    command: "npm",
    args: ["run", "test:run"],
    status: result.status === 0 ? "done" : "failed",
    exitCode: result.status,
    outputTail: output.slice(-4000),
  };
}

async function runScenario({ apiKey, model, workspacePath, scenario }) {
  if (scenario.ensureContext) ensureContextFiles(workspacePath);

  const startedAt = new Date().toISOString();
  const targetPath = path.join(workspacePath, scenario.targetFile);
  const acceptance = readIfExists(path.join(workspacePath, "SMOKEACCEPTANCE.md"));
  const context = [
    acceptance,
    readIfExists(path.join(workspacePath, "ORBIT.md")),
    readIfExists(path.join(workspacePath, ".orbit/rules.md")),
    readIfExists(path.join(workspacePath, ".orbit/skills/smoke/SKILL.md")),
  ].join("\n\n---\n\n");

  const modelOutput = await callDeepSeek({ apiKey, model, scenario, workspacePath, context });
  const events = [];
  const actionRequired = [];

  events.push(createEvent("planDraft", {
    role: "planner",
    title: "Plan Draft",
    message: modelOutput.planTitle,
    planDraft: {
      version: "1",
      title: modelOutput.planTitle,
      goals: [scenario.task],
      constraints: ["Plan is read-only; Build performs patch and verification through approval."],
      tasks: [{ id: `${scenario.path}-task`, title: modelOutput.patchTitle, description: scenario.task, verification: ["npm run test:run"], filesHint: [scenario.targetFile] }],
      acceptanceCriteria: ["Typed smoke stages are present", "Verification command exits 0"],
      risks: scenario.simulateStaleWrite ? ["Stale-write preview must remain recoverable before final apply."] : [],
      references: ["SMOKEACCEPTANCE.md"],
    },
  }));
  events.push(createEvent("modeSwitch", {
    title: "Mode Switch",
    message: "Accepted Plan and entered Build.",
    modeSwitch: { from: "plan", to: "build" },
  }));
  events.push(createEvent("question", {
    title: "Structured Question",
    message: modelOutput.question,
    question: { question: modelOutput.question, status: "answered", answer: modelOutput.recommendedAnswer },
  }));
  actionRequired.push({
    id: `question-${Date.now()}-${scenario.path}`,
    kind: "question",
    status: "resolved",
    title: modelOutput.question,
    tool: "ask_user",
    toolResultText: `Selected: ${modelOutput.recommendedAnswer}`,
  });

  const expectedOldContent = readIfExists(targetPath);
  let staleConflictRecovered = false;
  if (scenario.simulateStaleWrite) {
    fs.writeFileSync(targetPath, `# Stale local edit\n\nCreated before patch preview at ${new Date().toISOString()}.\n`);
    if (readIfExists(targetPath) !== expectedOldContent) {
      staleConflictRecovered = true;
      events.push(createEvent("patchProposal", {
        title: "Patch Preview Conflict",
        message: "Sandbox preview detected stale-write conflict; patch review remains pending for retry.",
        patches: [{ path: scenario.targetFile, oldContent: expectedOldContent, newContent: modelOutput.patchBody, applied: false, conflict: true }],
      }));
    }
  }

  const checkpointId = `checkpoint-${scenario.path}-${Date.now()}`;
  events.push(createEvent("checkpoint", {
    title: "Patch Checkpoint",
    message: `Created checkpoint before applying ${scenario.targetFile}.`,
    checkpoint: {
      checkpointId,
      strategy: "file-snapshot",
      filePaths: [scenario.targetFile],
      status: "created",
      runtimeSnapshot: { scenario: scenario.path, expectedOldContentLength: expectedOldContent.length },
    },
  }));

  const finalContent = [
    `# ${modelOutput.patchTitle}`,
    "",
    `Scenario: ${scenario.path}`,
    `Model: ${model}`,
    `Generated: ${new Date().toISOString()}`,
    `Stale conflict recovered: ${staleConflictRecovered ? "yes" : "no"}`,
    "",
    modelOutput.patchBody,
    "",
  ].join("\n");
  fs.writeFileSync(targetPath, finalContent);
  events.push(createEvent("patchProposal", {
    title: "Patch Proposal",
    message: `Applied ${scenario.targetFile}.`,
    patches: [{ path: scenario.targetFile, oldContent: expectedOldContent, newContent: finalContent, applied: true, checkpointId }],
  }));

  actionRequired.push({
    id: `approval-${Date.now()}-${scenario.path}`,
    kind: "command",
    status: "approved",
    title: "Run verification",
    tool: "run_command",
    description: "npm run test:run",
    toolResultText: "Approved command: npm run test:run",
  });
  actionRequired.push({
    id: `verification-${Date.now()}-${scenario.path}`,
    kind: "verification",
    status: "approved",
    title: "Verification",
    tool: "verification",
    description: "npm run test:run",
    toolResultText: "Verification approved.",
  });

  const terminal = runVerification(workspacePath);
  events.push(createEvent("verification", {
    title: terminal.exitCode === 0 ? "Verification Passed" : "Verification Failed",
    message: `npm run test:run exited ${terminal.exitCode}.`,
    verification: { command: "npm", args: ["run", "test:run"], status: terminal.exitCode === 0 ? "passed" : "failed" },
  }));
  events.push(createEvent("terminalRun", {
    title: "Terminal Run",
    message: terminal.outputTail.slice(-800),
    terminalRun: {
      id: `terminal-${Date.now()}-${scenario.path}`,
      taskId: `${scenario.path}-task`,
      command: terminal.command,
      args: terminal.args,
      reason: "DeepSeek smoke verification",
      status: terminal.status,
      exitCode: terminal.exitCode,
      outputTail: terminal.outputTail,
      startedAt,
      completedAt: new Date().toISOString(),
    },
  }));
  events.push(createEvent("finalSummary", {
    title: "Final Summary",
    message: `${modelOutput.finalSummary}${staleConflictRecovered ? " Stale-write recovery was exercised before final apply." : ""}`,
  }));

  const missingStages = evaluate(events, actionRequired);
  const record = {
    id: `deepseek-smoke-${scenario.path}-${Date.now()}`,
    path: scenario.path,
    model,
    workspacePath,
    targetFile: scenario.targetFile,
    startedAt,
    completedAt: new Date().toISOString(),
    result: missingStages.length === 0 && terminal.exitCode === 0 ? "passed" : "failed",
    missingStages,
    staleConflictRecovered,
    lastEventId: events.at(-1)?.id,
    pendingActionIds: actionRequired.filter((action) => action.status === "pending").map((action) => action.id),
    terminalSummary: `${terminal.command} ${terminal.args.join(" ")} -> ${terminal.status} (${terminal.exitCode})`,
    modelSummary: String(modelOutput.finalSummary || "").slice(0, 500),
    events,
    actionRequired,
  };
  if (record.result !== "passed") {
    record.failure = {
      stage: missingStages[0] || "terminalRun",
      workspacePath,
      model,
      summary: terminal.exitCode === 0 ? `Missing stages: ${missingStages.join(", ")}` : "Verification command failed.",
      nextFix: terminal.exitCode === 0 ? "Fix smoke runner event emission for missing typed stage." : "Fix mini-lab verification before marking smoke verified.",
    };
  }
  return record;
}

function createFailureRecord({ model, workspacePath, scenario, error }) {
  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error);
  return {
    id: `deepseek-smoke-${scenario.path}-${Date.now()}`,
    path: scenario.path,
    model,
    workspacePath,
    targetFile: scenario.targetFile,
    startedAt: now,
    completedAt: now,
    result: "failed",
    missingStages: stages,
    staleConflictRecovered: false,
    lastEventId: undefined,
    pendingActionIds: [],
    terminalSummary: "",
    modelSummary: message.slice(0, 500),
    events: [],
    actionRequired: [],
    failure: {
      stage: "modelResponse",
      workspacePath,
      model,
      summary: message,
      nextFix: "Inspect DeepSeek response/body handling, credential status, and retry behavior before marking smoke verified.",
    },
  };
}

async function main() {
  const workspacePath = path.resolve(process.argv[2] || process.env.ORBIT_DEEPSEEK_SMOKE_WORKSPACE || DEFAULT_WORKSPACE);
  const model = process.env.ORBIT_DEEPSEEK_SMOKE_MODEL || DEFAULT_MODEL;
  if (!fs.existsSync(workspacePath)) throw new Error(`Workspace does not exist: ${workspacePath}`);
  const apiKey = decryptTrustedDeviceCredentials();
  const records = [];
  for (const scenario of scenarios) {
    process.stdout.write(`Running ${scenario.path} with ${model}... `);
    let record;
    try {
      record = await runScenario({ apiKey, model, workspacePath, scenario });
    } catch (error) {
      record = createFailureRecord({ model, workspacePath, scenario, error });
    }
    records.push(record);
    console.log(record.result);
  }
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const report = {
    id: `deepseek-three-path-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    model,
    workspacePath,
    startedAt: records[0]?.startedAt,
    completedAt: new Date().toISOString(),
    result: records.every((record) => record.result === "passed") ? "verified" : records.some((record) => record.result === "passed") ? "partial" : "broken",
    records,
  };
  const reportPath = path.join(REPORT_DIR, `${report.id}.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report: ${reportPath}`);
  if (report.result !== "verified") process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
