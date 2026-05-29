import type { ResumeAction } from "../domain/actionRequired";
import type { TerminalRun } from "../domain/terminalRun";

export type ResumeKind = ResumeAction["type"] | "terminal";

export interface ResumeResult {
  kind: ResumeKind;
  resumeAction: ResumeAction;
  toolResultText: string;
  message: string;
  explicitContinueRequired: true;
}

export class ResumeController {
  resume(input: {
    kind: ResumeKind;
    resumeAction: ResumeAction;
    toolResultText: string;
    message: string;
  }): ResumeResult {
    return {
      ...input,
      explicitContinueRequired: true,
    };
  }

  terminalRecovery(run: TerminalRun): ResumeResult {
    return this.resume({
      kind: "terminal",
      resumeAction: { type: "approval", payloadId: run.id },
      toolResultText: run.outputTail || run.output || "Recovered terminal state requires explicit continue.",
      message: run.recoveredState === "unknown-needs-continue"
        ? "恢复的终端状态未知。点击“继续执行”后，Agent 会基于最后输出继续。"
        : "终端状态已恢复。点击“继续执行”后，Agent 会继续当前任务。",
    });
  }
}
