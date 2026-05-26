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
    run_command: copy.security.command,
    apply_patch: copy.security.write,
    ask_user: copy.workbench.agentEventNames.question,
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
    .replace(/run_command:\s*\{[\s\S]*?\}/g, copy.language === "中" ? "等待审查台处理：命令" : "Waiting for command review")
    .replace(
      /Requesting approval:\s*run_command\s*—\s*\{[\s\S]*?\}/g,
      copy.language === "中" ? "等待你在审查台批准命令" : "Waiting for command approval in Review Dock",
    )
    .replace(
      /Requesting approval:[^\n]*(run_command|command)[^\n]*/g,
      copy.language === "中" ? "等待你在审查台批准命令" : "Waiting for command approval in Review Dock",
    )
    .replace(
      /请求审批:\s*run_command\s*—\s*\{[\s\S]*?\}/g,
      copy.language === "中" ? "等待你在审查台批准命令" : "Waiting for command approval in Review Dock",
    )
    .replace(
      /请求审批:\s*命令\s*—\s*\{[\s\S]*?\}/g,
      copy.language === "中" ? "等待你在审查台批准命令" : "Waiting for command approval in Review Dock",
    )
    .replace(
      /请求审批:[\s\S]*?(run_command|命令)\s*[—-]\s*\{[\s\S]*?\}/g,
      copy.language === "中" ? "等待你在审查台批准命令" : "Waiting for command approval in Review Dock",
    )
    .replace(
      /请求审批:[^\n]*(run_command|命令)[^\n]*/g,
      copy.language === "中" ? "等待你在审查台批准命令" : "Waiting for command approval in Review Dock",
    )
    .replace(
      /Requesting approval:\s*apply_patch\s*—\s*\{[\s\S]*?\}/g,
      copy.language === "中" ? "等待你在审查台审查补丁" : "Waiting for patch review in Review Dock",
    )
    .replace(
      /请求审批:\s*apply_patch\s*—\s*\{[\s\S]*?\}/g,
      copy.language === "中" ? "等待你在审查台审查补丁" : "Waiting for patch review in Review Dock",
    )
    .replace(/Executing:\s*apply_patch/g, copy.language === "中" ? "正在处理：补丁" : "Processing patch")
    .replace(/Executing:\s*run_command/g, copy.language === "中" ? "正在处理：命令" : "Processing command")
    .replace(/\brun_command\b/g, copy.language === "中" ? "命令" : "command")
    .replace(/\bapply_patch\b/g, copy.language === "中" ? "补丁" : "patch");

  if (copy.language !== "中") return readableToolText;
  return [
    ["Review Dock", copy.workbench.reviewDock],
    ["Review dock", copy.workbench.reviewDock],
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

function summarizeToolEnvelopeText(copy: AppCopy, text: string): string | null {
  const parsed = parseToolEnvelopes(text);
  if (parsed.envelopes.length === 0) return null;

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

  if (envelope.tool === "apply_patch") {
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

  if (envelope.tool === "done") {
    const summary = typeof envelope.params.summary === "string" ? envelope.params.summary : "";
    return summary || (isZh ? "Agent 已完成当前任务。" : "Agent finished the current task.");
  }

  return null;
}
