import type { ThreadEvent } from "../domain/threadEvents";

export type HookKind = "beforePlan" | "afterPlan" | "beforeBuild" | "afterBuild" | "onActionRequired";

export interface HookInvocation {
  kind: HookKind;
  workspacePath?: string;
  threadId?: string;
  event?: ThreadEvent;
  message: string;
}

export interface HookAdapterResult {
  id: string;
  kind: HookKind;
  status: "recorded" | "skipped";
  message: string;
}

export interface HookAdapter {
  invoke(input: HookInvocation): Promise<HookAdapterResult>;
}

export class LoggingHookAdapter implements HookAdapter {
  async invoke(input: HookInvocation): Promise<HookAdapterResult> {
    return {
      id: `hook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: input.kind,
      status: "recorded",
      message: input.message,
    };
  }
}

export function rejectExecutableHook(content: string): boolean {
  return /\b(?:run|exec|spawn|shell|bash|zsh|powershell|cmd\.exe)\b/i.test(content);
}
