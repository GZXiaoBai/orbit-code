import type { SmokeRunRecord } from "./deepSeekSmokeHarness";
import {
  DEFAULT_DEEPSEEK_SMOKE_WORKSPACE,
  SmokeRunController,
  type SmokeRunControllerAdapter,
} from "./smokeRunController";

export type DeepSeekSmokePath = "happyPath" | "staleWriteRecovery" | "contextPath";

export interface DeepSeekSmokeScenario {
  path: DeepSeekSmokePath;
  task: string;
  requiredEvidence: string[];
}

export interface DeepSeekSmokeRunnerInput {
  model: string;
  providerId?: string;
  workspacePath?: string;
  paths?: DeepSeekSmokePath[];
}

export interface DeepSeekSmokeRunnerResult {
  workspacePath: string;
  model: string;
  records: SmokeRunRecord[];
  result: "verified" | "partial" | "broken";
}

export const DEEPSEEK_SMOKE_SCENARIOS: Record<DeepSeekSmokePath, DeepSeekSmokeScenario> = {
  happyPath: {
    path: "happyPath",
    task: "In orbit-mini-lab, do a read-only Plan review, accept Build, ask one structured question, propose a small patch, apply it, run verification, and produce final summary.",
    requiredEvidence: ["planDraft", "modeSwitch", "question", "patchProposal", "checkpoint", "verification", "terminalRun", "doneBuild"],
  },
  staleWriteRecovery: {
    path: "staleWriteRecovery",
    task: "Reproduce a stale-write patch preview conflict in orbit-mini-lab, keep patch review pending, then retry or go back to Plan and complete a corrected patch.",
    requiredEvidence: ["patchProposal", "checkpoint", "verification", "terminalRun", "doneBuild"],
  },
  contextPath: {
    path: "contextPath",
    task: "Run Plan then Build in orbit-mini-lab while ORBIT.md, .orbit/rules, and .orbit/skills are visible in Current Context but do not grant extra permissions.",
    requiredEvidence: ["planDraft", "modeSwitch", "approval", "patchProposal", "verification", "doneBuild"],
  },
};

export class DeepSeekSmokeRunner {
  constructor(private readonly adapter: SmokeRunControllerAdapter) {}

  async run(input: DeepSeekSmokeRunnerInput): Promise<DeepSeekSmokeRunnerResult> {
    const workspacePath = input.workspacePath || DEFAULT_DEEPSEEK_SMOKE_WORKSPACE;
    const paths = input.paths?.length ? input.paths : (Object.keys(DEEPSEEK_SMOKE_SCENARIOS) as DeepSeekSmokePath[]);
    const controller = new SmokeRunController(this.adapter);
    const records: SmokeRunRecord[] = [];

    for (const path of paths) {
      const scenario = DEEPSEEK_SMOKE_SCENARIOS[path];
      records.push(await controller.run({
        model: input.model,
        providerId: input.providerId,
        workspacePath,
        task: scenario.task,
      }));
    }

    const passed = records.filter((record) => record.result === "passed").length;
    return {
      workspacePath,
      model: input.model,
      records,
      result: passed === records.length ? "verified" : passed > 0 ? "partial" : "broken",
    };
  }
}
