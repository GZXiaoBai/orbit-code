import type { PlanTask, ProjectSecurityOverride, SecuritySettings } from "../domain/types";
import type { AgentSettings, ContextCompactionState } from "../domain/types";
import { isTauri } from "../utils/tauri";
import type {
  AgentLoopPhase,
  ToolCall,
  ToolName,
  LoopMessage,
  AgentLoopStatus,
  ToolParams,
} from "../domain/agentLoop";
import { executeToolCall, buildToolsPrompt, buildToolResultPrompt } from "../runtime/toolRegistry";
import { classifyCommand } from "../runtime/approvalPolicy";
import { formatCommandForDisplay } from "../runtime/commandParser";
import { gatherTaskContext } from "../runtime/semanticSearch";
import { analyzeProject } from "../runtime/projectAnalyzer";
import {
  callLLMApi,
  callLLMApiStreaming,
  type LLMProvider,
  type LLMCallRecord,
  type LLMRequestOptions,
} from "../services/llmService";
import { parseToolEnvelopes } from "../domain/agentToolEnvelope";
import { buildDeterministicContextSummary, shouldCompactContext } from "../domain/contextCompaction";
import { inferModelCapability } from "./modelSettings";

const AGENT_LOOP_SYSTEM_PROMPT = `You are an autonomous coding agent in Orbit Code.
You will be given a coding task and access to tools.
Follow these rules strictly:

1. FIRST, understand the task and research by reading relevant files and searching code.
2. THEN, plan your changes. Think about what files need modification.
3. PROPOSE changes using apply_patch. It creates reviewable patch sets; it does not write files.
4. AFTER the user approves patches, verify by running tests.
5. Use ask_user ONLY when you truly need input.

You MUST output tool calls in this exact format on a single line:
{"tool": "tool_name", "params": {"param1": "value1"}}

You can also comment/explain with text around tool calls.
When COMPLETELY done, output: {"tool": "done", "params": {"summary": "what you accomplished"}}

IMPORTANT: Always read a file before modifying it. Always search for related code before making changes.`;

export function parseToolCallsFromText(text: string): Array<{ id: string; name: string; params: ToolParams }> {
  const parsed = parseToolEnvelopes(text);
  return parsed.envelopes.map((envelope, index) => ({
    id: `tool-${Date.now()}-${index}`,
    name: envelope.tool,
    params: envelope.params,
  }));
}

export interface AgentLoopCallbacks {
  onPhaseChange: (phase: AgentLoopPhase, message: string) => void;
  onToolCall: (toolCall: ToolCall) => void;
  onToolResult: (toolCallId: string, result: string) => void;
  onRequestApproval: (tool: string, params: ToolParams) => Promise<boolean>;
  onAskUser?: (question: string, params: ToolParams) => Promise<string | null>;
  onPatchProposed?: (params: ToolParams) => Promise<string>;
  getWorkspacePath?: () => string;
  getSecuritySettings?: () => { global?: SecuritySettings; project?: ProjectSecurityOverride };
  getCommandSandboxMode?: () => string | undefined;
  getMaxIterations?: () => number;
  getAgentSettings?: () => AgentSettings | undefined;
  onError: (error: string) => void;
  onDone: (summary: string, tokenRecords: LLMCallRecord[]) => void;
  shouldCancel: () => boolean;
  onStreamStart?: (streamId: string) => void;
  onStreamChunk?: (streamId: string, content: string, accumulated: string) => void;
  onStreamEnd?: (streamId: string, finalContent: string) => void;
}

export class AgentLoopEngine {
  private callbacks: AgentLoopCallbacks;
  private isRunning: boolean = false;
  private phase: AgentLoopPhase = "idle";
  private iteration: number = 0;
  private maxIterations: number = 15;
  private messages: LoopMessage[] = [];
  private tokenRecords: LLMCallRecord[] = [];
  private contextCompaction: ContextCompactionState | undefined;
  private threadId: string = "default";
  private lastToolParseErrors: string[] = [];

  constructor(callbacks: AgentLoopCallbacks) {
    this.callbacks = callbacks;
  }

  getStatus(): AgentLoopStatus {
    const totalTokens = this.tokenRecords.reduce((sum, r) => sum + r.totalTokens, 0);
    return {
      isRunning: this.isRunning,
      phase: this.phase,
      currentTask: null,
      currentIteration: this.iteration,
      toolCalls: [],
      messages: this.messages,
      tokenRecords: [...this.tokenRecords],
      totalTokens,
      contextCompaction: this.contextCompaction,
    };
  }

  cancel(): void {
    this.isRunning = false;
    this.phase = "cancelled";
  }

  private setPhase(phase: AgentLoopPhase, message: string): void {
    this.phase = phase;
    this.callbacks.onPhaseChange(phase, message);
  }

  private async summarizeContextWithProvider(
    provider: LLMProvider,
    model: string,
    baseUrl: string | undefined,
    conversation: Array<{ role: "user" | "assistant"; content: string }>,
    options?: LLMRequestOptions,
  ): Promise<string> {
    const fallback = buildDeterministicContextSummary(conversation);
    if (!model) return fallback;

    try {
      const systemPrompt = [
        "You compress coding-agent context for later continuation.",
        "Return a concise structured summary with: goal, user constraints, files read, tool results, pending approvals, patch proposals, and next action.",
        "Do not invent facts. Do not include secrets.",
      ].join("\n");
      const userPrompt = conversation
        .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
        .join("\n\n---\n\n");
      const summary = await callLLMApi(
        provider,
        model,
        systemPrompt,
        userPrompt,
        baseUrl,
        (record) => this.tokenRecords.push(record),
        { ...options, reasoningEffort: "fast", maxOutputTokens: Math.min(options?.maxOutputTokens || 2000, 2400) },
      );
      return summary.trim() || fallback;
    } catch {
      return fallback;
    }
  }

  async runTask(
    task: PlanTask,
    provider: LLMProvider,
    model: string,
    baseUrl?: string,
    threadId?: string,
    options?: LLMRequestOptions
  ): Promise<string> {
    this.isRunning = true;
    this.iteration = 0;
    this.maxIterations = this.callbacks.getMaxIterations?.() || this.maxIterations;
    this.messages = [];
    this.threadId = threadId || `thread-${Date.now()}`;

    try {
      // Phase 1: Planning with smart context
      this.setPhase("planning", `Analyzing task: ${task.title}`);

      // Gather project info and relevant code context
      let projectContext = "";
      try {
        const projectInfo = await analyzeProject(this.callbacks.getWorkspacePath?.() || "");
        if (projectInfo) {
          projectContext = `\n\nProject Info:
- Type: ${projectInfo.type}
- Build tool: ${projectInfo.buildTool}
- Test command: ${Object.entries(projectInfo.scripts).find(([k]) => k === 'test')?.[1] || 'npm test'}
- Dependencies: ${projectInfo.dependencies.slice(0, 15).join(", ")}
- Has tests: ${projectInfo.hasTests}`;
          if (projectInfo.tsConfig) {
            projectContext += `\n- TypeScript: strict=${projectInfo.tsConfig.strict}, target=${projectInfo.tsConfig.target}, jsx=${projectInfo.tsConfig.jsx}`;
          }
        }
      } catch { /* optional */ }

      // Gather semantic code context
      let codeContext = "";
      try {
        codeContext = await gatherTaskContext(
          `${task.title} - ${task.description}`,
          provider,
          model,
          baseUrl,
          this.callbacks.getWorkspacePath?.() || ""
        );
      } catch { /* optional */ }

      const taskDescription = `Task: ${task.title}\nDescription: ${task.description}\nFiles hint: ${(task.filesHint || []).join(", ")}`;
      const fullSystemPrompt = AGENT_LOOP_SYSTEM_PROMPT + "\n" + buildToolsPrompt();
      const initialUserPrompt = `${taskDescription}\n${projectContext}\n\n${codeContext}\n\nBegin by reading relevant files and searching for related code. Then implement the changes.`;

      const conversation: Array<{ role: "user" | "assistant"; content: string }> = [
        { role: "user", content: initialUserPrompt },
      ];

      // Main loop: Reasoning + Acting
      while (this.iteration < this.maxIterations && this.isRunning) {
        this.iteration++;

        if (this.callbacks.shouldCancel()) {
          this.setPhase("cancelled", "Task cancelled by user");
          this.isRunning = false;
          return "Cancelled";
        }

        // Call LLM with conversation
        const messagesForLLM = conversation.map((m) => m.content).join("\n\n---\n\n");
        let llmResponse: string;
        try {
          this.callbacks.onStreamStart?.(`iter-${this.iteration}`);

          const streamHandle = callLLMApiStreaming(
            provider, model, fullSystemPrompt, messagesForLLM, baseUrl,
            (content, accumulated) => {
              this.callbacks.onStreamChunk?.(`iter-${this.iteration}`, content, accumulated);
            },
            options
          );

          try {
            llmResponse = await streamHandle.result;
          } catch (err: any) {
            this.callbacks.onStreamEnd?.(`iter-${this.iteration}`, "");
            throw err;
          }

          this.callbacks.onStreamEnd?.(`iter-${this.iteration}`, llmResponse);

          this.tokenRecords.push({
            id: `stream-${Date.now()}-${this.iteration}`,
            provider, model: model || "unknown",
            promptTokens: Math.ceil((fullSystemPrompt.length + messagesForLLM.length) / 4),
            completionTokens: Math.ceil(llmResponse.length / 4),
            totalTokens: Math.ceil((fullSystemPrompt.length + messagesForLLM.length + llmResponse.length) / 4),
            durationMs: 0,
            timestamp: new Date().toISOString(),
            streamed: true,
          });
        } catch (e: any) {
          this.setPhase("error", `LLM call failed: ${e?.message || String(e)}`);
          this.isRunning = false;
          throw e;
        }

        conversation.push({ role: "assistant", content: llmResponse });

        // Parse tool calls from response
        const toolCalls = this.parseToolCalls(llmResponse);

        if (toolCalls.length === 0) {
          // No tool call found — might be pure text, ask LLM to use tools
          conversation.push({
            role: "user",
            content: this.lastToolParseErrors.length > 0
              ? `Your tool call JSON was invalid and nothing was executed. Fix it and return exactly one strict JSON object on a single line.\nErrors:\n${this.lastToolParseErrors.join("\n")}`
              : "Please use a strict JSON tool call on one line to proceed. Available tools: read_file, search_code, list_files, apply_patch, run_command, ask_user.",
          });
          continue;
        }

        let allDone = false;
        const toolResults: Array<{ id: string; name: ToolName; result: string }> = [];

        for (const tc of toolCalls) {
          const toolName = tc.name as ToolName;
          if (toolName === "done") {
            allDone = true;
            const summary = typeof tc.params.summary === "string" ? tc.params.summary : "Task completed";
            this.setPhase("done", summary);
            this.callbacks.onDone(summary, [...this.tokenRecords]);
            this.isRunning = false;
            return summary;
          }

          // Handle ask_user
          if (toolName === "ask_user") {
            const question = typeof tc.params.question === "string" ? tc.params.question : "Continue?";
            this.setPhase("waiting_approval", question);
            const answer = this.callbacks.onAskUser
              ? await this.callbacks.onAskUser(question, tc.params)
              : (await this.callbacks.onRequestApproval("ask_user", { question }) ? "approved" : null);
            toolResults.push({
              id: tc.id,
              name: toolName,
              result: answer ? `User answered: ${answer}` : "User cancelled question.",
            });
            continue;
          }

          // Check approval for dangerous tools
          const approvalDefs: Record<string, boolean> = {
            run_command: true,
            apply_patch: false,
          };
          if (approvalDefs[toolName]) {
            const commandForPolicy = typeof tc.params.command === "string"
              ? formatCommandForDisplay(
                tc.params.command,
                Array.isArray(tc.params.args) ? tc.params.args.filter((arg): arg is string => typeof arg === "string") : []
              )
              : `${toolName} ${JSON.stringify(tc.params)}`;
            const security = this.callbacks.getSecuritySettings?.();
            const approvalMode = classifyCommand(commandForPolicy, security?.global, security?.project);
            if (approvalMode === "deny") {
              toolResults.push({
                id: tc.id,
                name: toolName,
                result: `DENIED: This operation is not allowed: ${toolName}`,
              });
              continue;
            }
            if (approvalMode === "ask") {
              this.setPhase("waiting_approval", `${toolName}: ${JSON.stringify(tc.params)}`);
              const approved = await this.callbacks.onRequestApproval(toolName, tc.params);
              if (!approved) {
                toolResults.push({ id: tc.id, name: toolName, result: "User denied this action." });
                continue;
              }
            }
          }

          // Execute tool
          this.setPhase(
            toolName === "apply_patch" ? "implementing" : toolName === "run_command" ? "verifying" : "researching",
            `Executing: ${toolName}`
          );

          this.callbacks.onToolCall({ ...tc, name: toolName, status: "running", startedAt: new Date().toISOString() });

          let result: string;
          try {
            if (toolName === "apply_patch" && this.callbacks.onPatchProposed) {
              result = await this.callbacks.onPatchProposed(tc.params);
            } else {
              result = await executeToolCall(toolName, tc.params, {
                workspacePath: this.callbacks.getWorkspacePath?.() || "",
                sandboxMode: this.callbacks.getCommandSandboxMode?.(),
              });
            }
            this.callbacks.onToolResult(tc.id, result);
          } catch (e: any) {
            result = `Tool error: ${e?.message || String(e)}`;
          }

          toolResults.push({ id: tc.id, name: toolName, result });
        }

        if (allDone) break;

        // Feed tool results back into conversation
        if (toolResults.length > 0) {
          const feedback = buildToolResultPrompt(toolResults);
          conversation.push({ role: "user", content: feedback });
        }

        this.persistIteration().catch(() => {});

        const agentSettings = this.callbacks.getAgentSettings?.();
        const modelCapability = inferModelCapability(provider, model);
        const compaction = shouldCompactContext({
          settings: agentSettings || {
            maxIterations: this.maxIterations,
            contextBudget: "balanced",
            autoCompact: true,
            autoSelfHeal: true,
            verificationApproval: true,
            fixtureProviderEnabled: true,
          },
          maxContextTokens: modelCapability.maxContextTokens,
          messages: conversation,
          iteration: this.iteration,
        });
        if (compaction.shouldCompact) {
          this.setPhase("compacting", "Compressing conversation context...");
          const summary = await this.summarizeContextWithProvider(provider, model, baseUrl, conversation, options);
          this.contextCompaction = {
            ...compaction.state,
            lastSummary: summary,
            compactedAtIteration: this.iteration,
          };
          conversation.splice(1, conversation.length - 3);
          conversation.splice(1, 0, {
            role: "user",
            content: summary,
          });
        }
      }

      if (this.iteration >= this.maxIterations) {
        this.setPhase("error", `Exceeded max iterations (${this.maxIterations})`);
      }
    } catch (e: any) {
      this.setPhase("error", `Agent loop error: ${e?.message || String(e)}`);
      this.callbacks.onError(e?.message || String(e));
    }

    this.isRunning = false;
    return "Agent loop ended";
  }

  private async persistIteration(): Promise<void> {
    if (!isTauri()) return;

    try {
      const invoke = (await import("@tauri-apps/api/core")).invoke;
      await invoke("create_message", {
        id: `msg-${Date.now()}-${this.iteration}`,
        threadId: this.threadId,
        role: "assistant",
        content: JSON.stringify({
          iteration: this.iteration,
          phase: this.phase,
          toolCalls: this.tokenRecords.map(r => ({
            provider: r.provider,
            totalTokens: r.totalTokens,
            streamed: r.streamed,
          })),
        }),
        agentRole: this.phase,
        metadata: JSON.stringify({
          totalTokens: this.tokenRecords.reduce((s, r) => s + r.totalTokens, 0),
          iteration: this.iteration,
        }),
      });
    } catch (e) {
      // Silently fail — persistence is best-effort, don't break the loop
    }
  }

  private parseToolCalls(text: string): Array<{ id: string; name: string; params: ToolParams }> {
    const parsed = parseToolEnvelopes(text);
    this.lastToolParseErrors = parsed.errors;
    return parsed.envelopes.map((envelope, index) => ({
      id: `tool-${Date.now()}-${index}`,
      name: envelope.tool,
      params: envelope.params,
    }));
  }
}
