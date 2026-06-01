#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { timestampId, writeSmokeReport } from "./smoke-report.mjs";

const APP_SUPPORT = process.env.ORBIT_APP_DATA_DIR
  ? path.resolve(process.env.ORBIT_APP_DATA_DIR)
  : path.join(process.env.HOME || "", "Library/Application Support/com.zhoujunjie.orbitcode");
const DB_PATH = process.env.ORBIT_DB_PATH || path.join(APP_SUPPORT, "orbit_code.db");
const DEVICE_KEY_PATH = process.env.ORBIT_DEVICE_KEY_PATH || path.join(APP_SUPPORT, "orbit-device-unlock.key");
const MODEL = process.env.ORBIT_DEEPSEEK_LIVE_MODEL || process.env.ORBIT_DEEPSEEK_SMOKE_MODEL || "deepseek-chat";
const TIMEOUT_MS = Number(process.env.ORBIT_LIVE_SMOKE_TIMEOUT_MS || 120_000);
const BUILD_APPROVAL_POLICY = process.env.ORBIT_LIVE_APPROVAL_POLICY || "untrusted";

function id(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function reportId() {
  return timestampId("codex-live-app-server");
}

function runSql(sql) {
  return execFileSync("sqlite3", [DB_PATH, sql], { encoding: "utf8" }).trim();
}

function decryptTrustedDeviceVault() {
  const rawEnvelope = runSql("select value from kv_store where key='credential.vault.auto_unlock';");
  if (!rawEnvelope) throw new Error("Orbit credential vault auto-unlock is not enabled.");
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

function sidecarPathForHost() {
  const key = `${process.platform}-${process.arch}`;
  const targets = {
    "darwin-arm64": "aarch64-apple-darwin",
    "darwin-x64": "x86_64-apple-darwin",
    "linux-x64": "x86_64-unknown-linux-gnu",
    "linux-arm64": "aarch64-unknown-linux-gnu",
    "win32-x64": "x86_64-pc-windows-msvc",
  };
  const target = targets[key];
  if (!target) throw new Error(`Unsupported live smoke host: ${key}`);
  return path.resolve("src-tauri/binaries", `codex-${target}${process.platform === "win32" ? ".exe" : ""}`);
}

function generatedConfig(baseUrl) {
  return `model_provider = "orbit-bridge"

[model_providers.orbit-bridge]
name = "Orbit Live Smoke Bridge"
base_url = "${baseUrl}"
wire_api = "responses"
`;
}

function responseContentToText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => item?.text ?? item?.input_text ?? item?.output_text ?? "")
      .filter(Boolean)
      .join("\n");
  }
  return value == null ? "" : JSON.stringify(value);
}

function responseToolToDeepSeek(tool) {
  if (!tool || (tool.type || "function") !== "function") return null;
  if (tool.function) return tool;
  if (!tool.name) return null;
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description || "",
      parameters: tool.parameters || tool.input_schema || { type: "object", properties: {} },
    },
  };
}

function responsesToDeepSeekChat(payload, fallbackModel) {
  const messages = [];
  if (typeof payload.instructions === "string" && payload.instructions.trim()) {
    messages.push({ role: "system", content: payload.instructions });
  }
  const input = payload.input;
  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
  } else if (Array.isArray(input)) {
    for (const item of input) {
      const type = item?.type || "message";
      if (type === "function_call_output" || type === "custom_tool_call_output") {
        const callId = item.call_id ? ` for ${item.call_id}` : "";
        messages.push({ role: "user", content: `Tool result${callId}:\n${responseContentToText(item.output)}` });
        continue;
      }
      const rawRole = item?.role || "user";
      const role = rawRole === "developer" ? "system" : ["system", "user", "assistant", "tool"].includes(rawRole) ? rawRole : "user";
      if (role === "tool") {
        messages.push({ role: "user", content: `Tool result:\n${responseContentToText(item.content)}` });
      } else {
        messages.push({ role, content: responseContentToText(item?.content) || JSON.stringify(item) });
      }
    }
  }
  const translated = {
    model: payload.model || fallbackModel,
    messages,
    stream: Boolean(payload.stream),
  };
  if (Array.isArray(payload.tools)) {
    const tools = payload.tools.map(responseToolToDeepSeek).filter(Boolean);
    if (tools.length) translated.tools = tools;
  }
  return translated;
}

function writeSse(res, event) {
  const kind = event.type || "response.output_item.done";
  res.write(`event: ${kind}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function proxyDeepSeekStream({ apiKey, payload, evidence, res }) {
  const responseId = id("resp");
  const assistantId = id("msg");
  const reasoningId = id("reasoning");
  let assistantStarted = false;
  let reasoningStarted = false;
  let assistantText = "";
  let reasoningText = "";
  let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const toolCalls = new Map();

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "close",
  });
  writeSse(res, {
    type: "response.created",
    response: {
      id: responseId,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      model: payload.model,
      status: "in_progress",
    },
  });

  const upstream = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ ...payload, stream: true, stream_options: { include_usage: true } }),
  });
  const upstreamTextPrefix = [];
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    throw new Error(`DeepSeek stream failed ${upstream.status}: ${text.slice(0, 300)}`);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of upstream.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        upstreamTextPrefix.push(data.slice(0, 120));
        continue;
      }
      if (parsed.usage) usage = parsed.usage;
      const delta = parsed.choices?.[0]?.delta || {};
      if (delta.reasoning_content) {
        if (!reasoningStarted) {
          reasoningStarted = true;
          writeSse(res, { type: "response.output_item.added", item: { type: "reasoning", id: reasoningId, summary: [], content: [] } });
        }
        reasoningText += delta.reasoning_content;
        writeSse(res, { type: "response.reasoning_text.delta", delta: delta.reasoning_content, content_index: 0 });
      }
      if (delta.content) {
        if (!assistantStarted) {
          assistantStarted = true;
          writeSse(res, {
            type: "response.output_item.added",
            item: { type: "message", role: "assistant", id: assistantId, content: [{ type: "output_text", text: "" }], phase: "final_answer" },
          });
        }
        assistantText += delta.content;
        writeSse(res, { type: "response.output_text.delta", delta: delta.content });
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const rawCall of delta.tool_calls) {
          const index = rawCall.index || 0;
          const current = toolCalls.get(index) || { id: "", type: "", name: "", arguments: "" };
          if (rawCall.id) current.id = rawCall.id;
          if (rawCall.type) current.type = rawCall.type;
          if (rawCall.function?.name) current.name += rawCall.function.name;
          if (rawCall.function?.arguments) current.arguments += rawCall.function.arguments;
          toolCalls.set(index, current);
        }
      }
    }
  }

  const output = [];
  if (reasoningStarted) {
    const item = { type: "reasoning", id: reasoningId, summary: [], content: [{ type: "reasoning_text", text: reasoningText }] };
    writeSse(res, { type: "response.output_item.done", item });
    output.push(item);
  }
  for (const call of [...toolCalls.values()]) {
    const callId = call.id || id("call");
    const item = { type: "function_call", id: callId, call_id: callId, name: call.name, arguments: call.arguments };
    writeSse(res, { type: "response.output_item.done", item });
    output.push(item);
  }
  if (assistantStarted) {
    const item = { type: "message", role: "assistant", id: assistantId, content: [{ type: "output_text", text: assistantText }], phase: "final_answer" };
    writeSse(res, { type: "response.output_item.done", item });
    output.push(item);
  }
  writeSse(res, {
    type: "response.completed",
    response: {
      id: responseId,
      object: "response",
      status: "completed",
      model: payload.model,
      output,
      usage: {
        input_tokens: usage.prompt_tokens || 0,
        output_tokens: usage.completion_tokens || 0,
        total_tokens: usage.total_tokens || 0,
      },
      end_turn: true,
    },
  });
  evidence.deepseekResponses += 1;
  evidence.assistantChars += assistantText.length;
  evidence.reasoningChars += reasoningText.length;
  evidence.toolCallCount += toolCalls.size;
  res.end();
}

function startBridge(apiKey, evidence) {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ object: "list", data: [{ id: MODEL, object: "model", owned_by: "deepseek" }] }));
        return;
      }
      if (req.method !== "POST" || req.url !== "/v1/responses") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "not_found", message: "Unsupported route" } }));
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString("utf8");
      const payload = body ? JSON.parse(body) : {};
      evidence.responsesRequests += 1;
      evidence.lastResponsesRequest = {
        model: payload.model,
        inputItems: Array.isArray(payload.input) ? payload.input.length : typeof payload.input,
        tools: Array.isArray(payload.tools) ? payload.tools.map((tool) => tool.name || tool.function?.name).filter(Boolean).slice(0, 20) : [],
        stream: Boolean(payload.stream),
      };
      const deepseekPayload = responsesToDeepSeekChat(payload, MODEL);
      await proxyDeepSeekStream({ apiKey, payload: deepseekPayload, evidence, res });
    } catch (error) {
      if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "bridge_failed", message: error instanceof Error ? error.message : String(error) } }));
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}/v1` });
    });
  });
}

function jsonRpcClient(child, evidence) {
  let nextId = 1;
  const pending = new Map();
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        evidence.invalidJson.push(line.slice(0, 300));
        continue;
      }
      evidence.jsonRpcMessages += 1;
      if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
        const entry = pending.get(message.id);
        if (entry) {
          pending.delete(message.id);
          message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
        }
        continue;
      }
      if (message.id !== undefined && message.method) {
        evidence.serverRequests.push({ id: message.id, method: message.method, params: message.params });
        const result = approvalResult(message.method, message.params);
        child.stdin.write(`${JSON.stringify({ id: message.id, result })}\n`);
        continue;
      }
      if (message.method) {
        evidence.notifications.push({ method: message.method, params: message.params });
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8").trim();
    if (text) evidence.stderr.push(text);
  });
  return {
    request(method, params, timeoutMs = 30_000) {
      const requestId = nextId++;
      child.stdin.write(`${JSON.stringify({ id: requestId, method, params })}\n`);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`Timed out waiting for ${method}`));
        }, timeoutMs);
        pending.set(requestId, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
      });
    },
    notify(method, params = {}) {
      child.stdin.write(`${JSON.stringify({ method, params })}\n`);
    },
  };
}

function approvalResult(method, params) {
  if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
    return { decision: "accept" };
  }
  if (method === "item/permissions/requestApproval") {
    const permissions = params?.permissions || {};
    return {
      permissions: {
        ...(permissions.network ? { network: permissions.network } : {}),
        ...(permissions.fileSystem ? { fileSystem: permissions.fileSystem } : {}),
      },
      scope: "turn",
      strictAutoReview: true,
    };
  }
  if (method === "item/tool/requestUserInput") {
    const answers = {};
    for (const question of params?.questions || []) {
      answers[question.id || "answer"] = { answers: ["Proceed with the smoke-safe default."] };
    }
    return { answers: Object.keys(answers).length ? answers : { answer: { answers: ["Proceed."] } } };
  }
  if (method === "mcpServer/elicitation/request") {
    return { action: "accept", content: { answer: "Proceed." }, _meta: null };
  }
  return { decision: "approved", answer: "Proceed." };
}

function hasCompletion(evidence) {
  return evidence.notifications.some((item) => item.method === "turn/completed")
    || evidence.notifications.some((item) => item.method === "thread/status/changed" && item.params?.status?.type === "idle");
}

function criterion(id, label, ok, evidence = {}) {
  return { id, label, status: ok ? "verified" : "missing", evidence };
}

async function main() {
  const startedAt = new Date().toISOString();
  const vault = decryptTrustedDeviceVault();
  const apiKey = vault.providers?.deepseek;
  if (!apiKey) throw new Error("DeepSeek credential is not available in Orbit trusted-device vault.");
  const codexBinary = sidecarPathForHost();
  if (!fs.existsSync(codexBinary)) throw new Error(`Prepared Codex sidecar not found: ${codexBinary}`);

  const evidence = {
    responsesRequests: 0,
    deepseekResponses: 0,
    assistantChars: 0,
    reasoningChars: 0,
    toolCallCount: 0,
    jsonRpcMessages: 0,
    serverRequests: [],
    notifications: [],
    stderr: [],
    invalidJson: [],
    lastResponsesRequest: null,
  };
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-codex-live-"));
  fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ scripts: { test: "node -e \"console.log('orbit live smoke ok')\"" } }, null, 2));
  fs.writeFileSync(path.join(workspace, "README.md"), "# Orbit live smoke\n\nThis temporary workspace is safe to edit.\n");

  let bridge;
  let child;
  try {
    bridge = await startBridge(apiKey, evidence);
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-codex-home-"));
    fs.writeFileSync(path.join(codexHome, "config.toml"), generatedConfig(bridge.baseUrl));
    child = spawn(codexBinary, ["app-server", "--listen", "stdio://"], {
      env: { ...process.env, CODEX_HOME: codexHome },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const rpc = jsonRpcClient(child, evidence);
    const initialize = await rpc.request("initialize", {
      clientInfo: { name: "orbit-code-live-smoke", title: "Orbit Code Live Smoke", version: "1.0.0" },
      capabilities: null,
    }, 20_000);
    rpc.notify("initialized");
    const thread = await rpc.request("thread/start", {
      model: MODEL,
      modelProvider: "orbit-bridge",
      cwd: workspace,
      approvalPolicy: BUILD_APPROVAL_POLICY,
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      ephemeral: true,
      serviceName: "Orbit Code Live Smoke",
    }, 30_000);
    const threadId = thread?.thread?.id;
    if (!threadId) throw new Error(`thread/start response missing thread id: ${JSON.stringify(thread)}`);
    await rpc.request("turn/start", {
      threadId,
      input: [{
        type: "text",
        text: [
          "This is an automated Orbit Code live smoke in a temporary workspace.",
          "Create a file named SMOKE_CODEX_LIVE.md containing one short sentence, run npm test, then summarize what changed.",
          "Use tools when needed. Keep the change tiny.",
        ].join("\n"),
        text_elements: [],
      }],
      cwd: workspace,
      approvalPolicy: BUILD_APPROVAL_POLICY,
      approvalsReviewer: "user",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: [workspace],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
      model: MODEL,
      effort: "low",
    }, 30_000);

    await new Promise((resolve) => {
      const deadline = Date.now() + TIMEOUT_MS;
      const timer = setInterval(() => {
        if (hasCompletion(evidence) || Date.now() > deadline) {
          clearInterval(timer);
          resolve();
        }
      }, 500);
    });

    const targetFile = path.join(workspace, "SMOKE_CODEX_LIVE.md");
    const completedAt = new Date().toISOString();
    const criteria = [
      criterion("initialize", "Codex app-server initialize completed.", Boolean(initialize), { capabilities: Object.keys(initialize || {}) }),
      criterion("thread-start", "Codex app-server thread/start returned a thread id.", Boolean(threadId), { threadId }),
      criterion("responses-bridge", "Codex app-server called the Orbit live Responses bridge.", evidence.responsesRequests > 0, evidence.lastResponsesRequest || {}),
      criterion("deepseek-live", "The live bridge completed at least one DeepSeek Responses stream.", evidence.deepseekResponses > 0, { assistantChars: evidence.assistantChars, reasoningChars: evidence.reasoningChars }),
      criterion("turn-completed", "Codex app-server emitted turn completion or idle status.", hasCompletion(evidence), { notificationMethods: evidence.notifications.map((item) => item.method).slice(-20) }),
      criterion("final-assistant", "Codex app-server streamed a final assistant summary.", evidence.assistantChars > 0 && evidence.notifications.some((item) => item.method === "item/agentMessage/delta"), {
        assistantChars: evidence.assistantChars,
        deltaCount: evidence.notifications.filter((item) => item.method === "item/agentMessage/delta").length,
      }),
      criterion("usage", "Codex app-server emitted token usage updates.", evidence.notifications.some((item) => item.method === "thread/tokenUsage/updated"), {
        count: evidence.notifications.filter((item) => item.method === "thread/tokenUsage/updated").length,
      }),
      criterion("terminal-output", "Codex app-server emitted command execution terminal output.", evidence.notifications.some((item) => item.method === "item/commandExecution/outputDelta"), {
        count: evidence.notifications.filter((item) => item.method === "item/commandExecution/outputDelta").length,
      }),
      criterion("approval-loop", "Codex app-server issued at least one approval or user-input request.", evidence.serverRequests.length > 0, { methods: evidence.serverRequests.map((item) => item.method) }),
      criterion("file-edit", "The live Build created the requested smoke file.", fs.existsSync(targetFile), { path: targetFile, content: fs.existsSync(targetFile) ? fs.readFileSync(targetFile, "utf8").slice(0, 400) : undefined }),
    ];
    const verified = criteria.every((item) => item.status === "verified");
    const partial = criteria.some((item) => item.status === "verified");
    const report = {
      id: reportId(),
      runtime: "codex-sidecar.v1",
      provider: "deepseek",
      model: MODEL,
      approvalPolicy: BUILD_APPROVAL_POLICY,
      workspace,
      startedAt,
      completedAt,
      result: verified ? "verified" : partial ? "partial" : "broken",
      criteria,
      evidence: {
        responsesRequests: evidence.responsesRequests,
        deepseekResponses: evidence.deepseekResponses,
        assistantChars: evidence.assistantChars,
        reasoningChars: evidence.reasoningChars,
        toolCallCount: evidence.toolCallCount,
        jsonRpcMessages: evidence.jsonRpcMessages,
        commandOutputCount: evidence.notifications.filter((item) => item.method === "item/commandExecution/outputDelta").length,
        serverRequestMethods: evidence.serverRequests.map((item) => item.method),
        notificationMethods: evidence.notifications.map((item) => item.method),
        stderrTail: evidence.stderr.join("\n").slice(-4000),
        invalidJson: evidence.invalidJson,
      },
    };
    writeSmokeReport("codex-live-app-server", report, "Codex live app-server smoke report");
    console.log(`Result: ${report.result}`);
    if (process.env.ORBIT_REQUIRE_LIVE_BUILD === "1" && report.result !== "verified") process.exitCode = 1;
  } finally {
    if (child && !child.killed) child.kill();
    if (bridge) await new Promise((resolve) => bridge.server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
