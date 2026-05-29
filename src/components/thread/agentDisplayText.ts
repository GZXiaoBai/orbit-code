import type { AppCopy } from "../../i18n/copy";
import { parseToolEnvelopes } from "../../domain/agentToolEnvelope";

export function localizedAgentEventName(copy: AppCopy, name: string): string {
  const eventNames: Record<string, string> = {
    "Plan Ready": copy.workbench.agentEventNames.planReady,
    "Approval Gate": copy.workbench.agentEventNames.approvalGate,
    "Approval Denied": copy.workbench.agentEventNames.approvalDenied,
    "Approval Granted": copy.workbench.agentEventNames.approvalGranted,
    "Recovered Approval Denied": copy.workbench.agentEventNames.recoveredApprovalDenied,
    "Recovered Waiting State": copy.workbench.agentEventNames.recoveredWaitingState,
    "Recovered Approval Granted": copy.workbench.agentEventNames.recoveredApprovalGranted,
    "Recovered Question Answered": copy.workbench.agentEventNames.recoveredQuestionAnswered,
    "Recovered Question Cancelled": copy.workbench.agentEventNames.recoveredQuestionCancelled,
    "Self-Healing Coder": copy.workbench.agentEventNames.selfHealingCoder,
    "Patch Proposal": copy.workbench.agentEventNames.patchProposal,
    "Question": copy.workbench.agentEventNames.question,
    "Question Answered": copy.workbench.agentEventNames.questionAnswered,
    "Question Cancelled": copy.workbench.agentEventNames.questionCancelled,
    "Verification": copy.workbench.agentEventNames.verification,
    "Verification Approval": copy.workbench.agentEventNames.verificationApproval,
    "Verification Denied": copy.workbench.agentEventNames.verificationDenied,
    "Run Guard": copy.workbench.agentEventNames.runGuard,
    "Agent Error": copy.workbench.agentEventNames.agentError,
    "Waiting For Continue": copy.workbench.agentEventNames.waitingForContinue,
    "Continue Agent": copy.workbench.agentEventNames.continueAgent,
    "Final Summary": copy.workbench.agentEventNames.finalSummary,
    run_command: copy.security.command,
    apply_patch: copy.security.write,
    propose_patch: copy.security.write,
    ask_user: copy.workbench.agentEventNames.question,
    done_plan: copy.workbench.agentEventNames.planReady,
    done_build: copy.workbench.agentEventNames.finalSummary,
  };
  if (eventNames[name]) return eventNames[name];

  const agentPhase = name.match(/^Agent \(([^)]+)\)$/);
  if (agentPhase) {
    const phase = agentPhase[1] as keyof typeof copy.workbench.agentPhases;
    return copy.workbench.agentPhases[phase] || agentPhase[1];
  }

  return name;
}

export function localizedRuntimeText(copy: AppCopy, text: string): string {
  const toolSummary = summarizeToolEnvelopeText(copy, text);
  if (toolSummary) return toolSummary;

  const readableToolText = text
    .replace(/run_command:\s*\{[\s\S]*?\}/g, copy.language === "中" ? "等待中心授权：命令" : "Waiting for command approval")
    .replace(
      /Requesting approval:\s*run_command\s*—\s*\{[\s\S]*?\}/g,
      copy.language === "中" ? "等待你在中心授权命令" : "Waiting for command approval",
    )
    .replace(
      /Requesting approval:[^\n]*(run_command|command)[^\n]*/g,
      copy.language === "中" ? "等待你在中心授权命令" : "Waiting for command approval",
    )
    .replace(
      /请求审批:\s*run_command\s*—\s*\{[\s\S]*?\}/g,
      copy.language === "中" ? "等待你在中心授权命令" : "Waiting for command approval",
    )
    .replace(
      /请求审批:\s*命令\s*—\s*\{[\s\S]*?\}/g,
      copy.language === "中" ? "等待你在中心授权命令" : "Waiting for command approval",
    )
    .replace(
      /请求审批:[\s\S]*?(run_command|命令)\s*[—-]\s*\{[\s\S]*?\}/g,
      copy.language === "中" ? "等待你在中心授权命令" : "Waiting for command approval",
    )
    .replace(
      /请求审批:[^\n]*(run_command|命令)[^\n]*/g,
      copy.language === "中" ? "等待你在中心授权命令" : "Waiting for command approval",
    )
    .replace(
      /Requesting approval:\s*apply_patch\s*—\s*\{[\s\S]*?\}/g,
      copy.language === "中" ? "等待你在中心审查补丁" : "Waiting for patch review",
    )
    .replace(
      /请求审批:\s*apply_patch\s*—\s*\{[\s\S]*?\}/g,
      copy.language === "中" ? "等待你在中心审查补丁" : "Waiting for patch review",
    )
    .replace(/Executing:\s*apply_patch/g, copy.language === "中" ? "正在处理：补丁" : "Processing patch")
    .replace(/Executing:\s*propose_patch/g, copy.language === "中" ? "正在处理：补丁" : "Processing patch")
    .replace(/Executing:\s*run_command/g, copy.language === "中" ? "正在处理：命令" : "Processing command")
    .replace(/\brun_command\b/g, copy.language === "中" ? "命令" : "command")
    .replace(/\bapply_patch\b/g, copy.language === "中" ? "补丁" : "patch");

  if (copy.language !== "中") return readableToolText;
  return [
    ["Review Dock", copy.language === "中" ? "详情检查器" : "Inspector"],
    ["Review dock", copy.language === "中" ? "详情检查器" : "Inspector"],
    ["Requesting approval", "请求审批"],
    ["Executing:", "正在执行："],
    ["Command:", "命令："],
    ["Stdout:", "标准输出："],
    ["Stderr:", "错误输出："],
    ["Exit Code:", "退出码："],
    ["Sandbox preview created for", "沙盒预演完成："],
    ["patch(es). No workspace files were changed.", "个补丁。当前工作区未被修改。"],
    ["No workspace files were changed.", "当前工作区未被修改。"],
  ].reduce((current, [from, to]) => current.split(from).join(to), readableToolText);
}

export function compactRuntimeTextForTimeline(copy: AppCopy, text: string, maxLength = 900): string {
  const localized = localizedRuntimeText(copy, text).trim();
  const withoutFabricatedToolResult = localized
    .replace(/\[Tool\s+[^\]]+\s+result\]:[\s\S]*?(?=\n\s*\{"tool"|$)/gi, copy.language === "中" ? "已忽略模型伪造的工具结果。" : "Ignored model-fabricated tool result.")
    .trim();
  const sanitized = removeRawToolPayloads(copy, withoutFabricatedToolResult);
  const normalized = sanitized.replace(/\n{3,}/g, "\n\n");
  const lineCount = normalized.split("\n").length;

  if (normalized.length <= maxLength && lineCount <= 18) return normalized;

  const suffix = copy.language === "中"
    ? "…\n已折叠较长输出；完整命令输出、Diff 或文件内容请在详情检查器查看。"
    : "…\nLong output collapsed; inspect full command output, diff, or file content in the Inspector.";
  return `${normalized.slice(0, maxLength).trimEnd()}${suffix}`;
}

function summarizeToolEnvelopeText(copy: AppCopy, text: string): string | null {
  const parsed = parseToolEnvelopes(text);
  if (parsed.envelopes.length === 0) {
    return summarizeEmbeddedToolEnvelopeText(copy, text);
  }

  const envelope = parsed.envelopes[0];
  const isZh = copy.language === "中";

  if (envelope.tool === "run_command") {
    const command = typeof envelope.params.command === "string" ? envelope.params.command : "command";
    const args = Array.isArray(envelope.params.args) ? envelope.params.args.filter((arg): arg is string => typeof arg === "string") : [];
    const reason = typeof envelope.params.reason === "string" ? envelope.params.reason.trim() : "";
    const display = [command, ...args].join(" ");
    return isZh
      ? `Agent 请求运行命令：${display}${reason ? `。原因：${reason}` : ""}`
      : `Agent requested a command: ${display}${reason ? `. Reason: ${reason}` : ""}`;
  }

  if (envelope.tool === "apply_patch" || envelope.tool === "propose_patch") {
    const patches = Array.isArray(envelope.params.patches) ? envelope.params.patches : [];
    const files = patches
      .map((patch) => typeof patch === "object" && patch && "path" in patch ? String((patch as { path?: unknown }).path || "") : "")
      .filter(Boolean);
    const preview = files.length ? `（${files.slice(0, 3).join("、")}${files.length > 3 ? " 等" : ""}）` : "";
    return isZh
      ? `Agent 提出补丁审查：${files.length || patches.length} 个文件${preview}`
      : `Agent proposed a patch review for ${files.length || patches.length} file(s)${files.length ? ` (${files.slice(0, 3).join(", ")}${files.length > 3 ? ", ..." : ""})` : ""}`;
  }

  if (envelope.tool === "ask_user") {
    const question = typeof envelope.params.question === "string" ? envelope.params.question : "";
    return isZh ? `Agent 正在询问：${question}` : `Agent is asking: ${question}`;
  }

  if (envelope.tool === "read_file") {
    const path = typeof envelope.params.path === "string" ? envelope.params.path : "";
    return isZh ? `Agent 准备读取文件：${path}` : `Agent is preparing to read: ${path}`;
  }

  if (envelope.tool === "search_code") {
    const query = typeof envelope.params.query === "string" ? envelope.params.query : envelope.params.pattern;
    return isZh ? `Agent 准备搜索代码：${typeof query === "string" ? query : ""}` : `Agent is preparing to search code: ${typeof query === "string" ? query : ""}`;
  }

  if (envelope.tool === "list_files") {
    return isZh ? "Agent 准备读取项目文件列表" : "Agent is preparing to list project files";
  }

  if (envelope.tool === "done" || envelope.tool === "done_plan" || envelope.tool === "done_build") {
    const summary = typeof envelope.params.summary === "string" ? envelope.params.summary : "";
    return summary || (isZh ? "Agent 已完成当前任务。" : "Agent finished the current task.");
  }

  return null;
}

function summarizeEmbeddedToolEnvelopeText(copy: AppCopy, text: string): string | null {
  if (!/"\s*tool\s*":/.test(text) || !/"\s*params\s*":/.test(text)) return null;

  for (const candidate of extractBalancedJsonObjects(text)) {
    if (!candidate.json.includes('"tool"')) continue;
    const parsed = parseToolEnvelopes(candidate.json);
    if (parsed.envelopes.length === 0) continue;
    return summarizeToolEnvelopeText(copy, candidate.json);
  }

  if (looksLikeRawPatchPayload(text)) {
    return copy.language === "中"
      ? "Agent 提出补丁审查，请在中心浮层处理；完整 Diff 可在详情检查器查看。"
      : "Agent proposed a patch review. Use the center overlay; inspect the full diff in the Inspector.";
  }

  return copy.language === "中"
    ? "Agent 正在准备工具调用，详情会进入事件流。"
    : "Agent is preparing a tool call. Details will appear in the event stream.";
}

function removeRawToolPayloads(copy: AppCopy, text: string): string {
  if (!looksLikeRawToolPayload(text)) return text;

  let sanitized = text;
  for (const candidate of extractBalancedJsonObjects(text)) {
    if (!candidate.json.includes('"tool"')) continue;
    const summary = summarizeToolEnvelopeText(copy, candidate.json);
    sanitized = sanitized.replace(candidate.json, summary || fallbackToolPayloadText(copy, candidate.json));
  }

  if (looksLikeRawToolPayload(sanitized)) {
    return fallbackToolPayloadText(copy, sanitized);
  }
  return sanitized;
}

function fallbackToolPayloadText(copy: AppCopy, text: string): string {
  if (looksLikeRawPatchPayload(text)) {
    return copy.language === "中"
      ? "Agent 提出补丁审查，请在中心浮层处理；完整 Diff 可在详情检查器查看。"
      : "Agent proposed a patch review. Use the center overlay; inspect the full diff in the Inspector.";
  }
  return copy.language === "中"
    ? "Agent 正在准备工具调用，详情会进入事件流。"
    : "Agent is preparing a tool call. Details will appear in the event stream.";
}

function looksLikeRawToolPayload(text: string): boolean {
  return /"\s*tool\s*":/.test(text)
    || /"\s*params\s*":/.test(text)
    || looksLikeRawPatchPayload(text);
}

function looksLikeRawPatchPayload(text: string): boolean {
  return /"\s*patches\s*":/.test(text)
    || /\b(?:oldContent|newContent)\b/.test(text);
}

function extractBalancedJsonObjects(text: string): Array<{ json: string; start: number; end: number }> {
  const objects: Array<{ json: string; start: number; end: number }> = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push({ json: text.slice(start, index + 1), start, end: index + 1 });
        start = -1;
      }
    }
  }

  return objects;
}
