import type { AgentRuntimeMode, ToolCall, ToolName } from "../domain/agentLoop";
import { publicToolNamesForMode } from "../domain/agentModeContract";
import type { PermissionScheduler } from "../runtime/permissionScheduler";
import { executeToolCall } from "../runtime/toolRegistry";
import {
  ToolCallExecutor,
  type ToolExecutionResult,
  type ToolLifecycleStore,
} from "./toolCallExecutor";

export interface PiToolExecutorContext {
  mode: AgentRuntimeMode;
  workspacePath?: string;
  sandboxMode?: string;
  permissionScheduler?: PermissionScheduler;
  threadId?: string;
  runSessionId?: string;
}

export class PiToolExecutor {
  private readonly executor: ToolCallExecutor;

  constructor(lifecycle: ToolLifecycleStore) {
    this.executor = new ToolCallExecutor(lifecycle);
  }

  async execute(toolCall: ToolCall, context: PiToolExecutorContext): Promise<ToolExecutionResult> {
    if (!isToolAllowedInMode(toolCall.name, context.mode)) {
      const toolResult = `Tool denied by ${context.mode} mode: ${toolCall.name}`;
      this.executor.recordGenerated(toolCall, toolCall.name);
      this.executor.recordResult(toolCall.id, toolResult);
      return {
        approved: false,
        toolResult,
        status: "denied",
      };
    }

    if (context.permissionScheduler && requiresDurableAction(toolCall.name)) {
      return this.executor.execute(toolCall, {
        mode: context.mode,
        permissionScheduler: context.permissionScheduler,
        workspacePath: context.workspacePath,
        threadId: context.threadId,
        runSessionId: context.runSessionId,
        toolCallId: toolCall.id,
      });
    }

    return this.executor.executeApprovedTool(toolCall, () => executeToolCall(toolCall.name, toolCall.params, {
      workspacePath: context.workspacePath,
      sandboxMode: context.sandboxMode,
    }));
  }
}

export function isToolAllowedInMode(tool: ToolName | string, mode: AgentRuntimeMode): boolean {
  return publicToolNamesForMode(mode).includes(tool as ToolName);
}

function requiresDurableAction(tool: ToolName | string): boolean {
  return ["run_command", "apply_patch", "propose_patch", "verification"].includes(tool);
}
