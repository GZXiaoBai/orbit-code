import type { AppCopy } from "../../i18n/copy";

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
  };
  if (eventNames[name]) return eventNames[name];

  const agentPhase = name.match(/^Agent \(([^)]+)\)$/);
  if (agentPhase) {
    const phase = agentPhase[1] as keyof typeof copy.workbench.agentPhases;
    return `Agent (${copy.workbench.agentPhases[phase] || agentPhase[1]})`;
  }

  return name;
}

export function localizedRuntimeText(copy: AppCopy, text: string): string {
  if (copy.language !== "中") return text;
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
  ].reduce((current, [from, to]) => current.split(from).join(to), text);
}
