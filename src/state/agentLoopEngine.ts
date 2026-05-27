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
4. STOP after apply_patch and wait for the user to review and apply the patch in the Review Dock.
5. AFTER the user applies patches and explicitly starts verification, verify by running tests.
6. Use ask_user ONLY when you truly need input.
7. NEVER invent tool results. Do not write "[Tool ... result]" sections yourself; Orbit will provide real tool results after executing approved tools.
8. For commands inside a generated app or subdirectory, use run_command.cwd. Never use "cd ... && ...".
9. Do not ask whether patches were reviewed unless Orbit has returned a real apply_patch result first.
10. Keep apply_patch small and reviewable: include at most 3 files per apply_patch call. For generated projects, send config files first, then wait; after the user applies and continues, send source files in later apply_patch calls.
11. Never try to create an entire app in one apply_patch. Large JSON tool calls can be truncated and will be rejected.

You MUST output exactly one complete JSON tool call at a time:
{"tool": "tool_name", "params": {"param1": "value1"}}

Do not wrap the JSON in Markdown. Do not output prose before or after a tool call.
When COMPLETELY done, output: {"tool": "done", "params": {"summary": "what you accomplished"}}

IMPORTANT: Always read a file before modifying it. Always search for related code before making changes.`;

function invalidRunCommandMessage(params: ToolParams): string | null {
  const command = typeof params.command === "string" ? params.command.trim() : "";
  if (!command) return "Invalid run_command: command is required.";
  if (command === "cd" || /[;&|`$<>]/.test(command)) {
    return [
      "Invalid run_command: use one executable plus args; do not use shell operators or cd.",
      "If the command belongs in a subdirectory, pass cwd, for example:",
      '{"tool":"run_command","params":{"command":"npm","args":["install"],"cwd":"orbit-mini-lab","reason":"install dependencies in the generated app"}}',
    ].join("\n");
  }
  return null;
}

export function stripFabricatedToolResults(text: string): string {
  const withoutXmlBlocks = text.replace(/<tool_result\b[^>]*>[\s\S]*?<\/tool_result>/gi, "");
  const lines = withoutXmlBlocks.split("\n");
  const kept: string[] = [];
  let skippingFabricatedResult = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[Tool\s+[a-z_]+\s+result\]:/i.test(trimmed) || /^#?\s*Tool ran without output or errors/i.test(trimmed)) {
      skippingFabricatedResult = true;
      continue;
    }
    if (skippingFabricatedResult) {
      if (!trimmed) {
        skippingFabricatedResult = false;
      }
      if (trimmed.startsWith('{"tool"')) {
        skippingFabricatedResult = false;
        kept.push(line);
      }
      continue;
    }
    kept.push(line);
  }

  return kept.join("\n").trim();
}

export function parseToolCallsFromText(text: string): Array<{ id: string; name: string; params: ToolParams }> {
  const parsed = parseToolEnvelopes(text);
  return parsed.envelopes.map((envelope, index) => ({
    id: `tool-${Date.now()}-${index}`,
    name: envelope.tool,
    params: envelope.params,
  }));
}

export function doneSummaryClaimsUncreatedPatch(summary: string, patchProposalCreated: boolean): boolean {
  const claimsPatchOrFiles = /(patch|patches|diff|review dock|审查台|补丁|文件修改|created .*file|updated .*file|waiting for .*review|等待.*审查)/i.test(summary);
  return claimsPatchOrFiles && !patchProposalCreated;
}

export interface AgentLoopCallbacks {
  onPhaseChange: (phase: AgentLoopPhase, message: string) => void;
  onIteration?: (iteration: number, summary: string) => void;
  onToolCall: (toolCall: ToolCall) => void;
  onToolResult: (toolCallId: string, result: string) => void;
  onRequestApproval: (tool: string, params: ToolParams) => Promise<boolean>;
  onAskUser?: (question: string, params: ToolParams) => Promise<string | null>;
  onPatchProposed?: (params: ToolParams) => Promise<string>;
  onContextCompaction?: (state: ContextCompactionState) => void;
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
  private consecutiveInvalidToolResponses: number = 0;
  private patchProposalCreated: boolean = false;
  private finalSummaryOnly: boolean = false;

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
    options?: LLMRequestOptions,
    resumeContext?: string,
  ): Promise<string> {
    this.isRunning = true;
    this.iteration = 0;
    this.maxIterations = this.callbacks.getMaxIterations?.() || this.maxIterations;
    this.messages = [];
    this.threadId = threadId || `thread-${Date.now()}`;
    this.finalSummaryOnly = Boolean(resumeContext && /final-summary pass|final summary pass|最终总结/i.test(resumeContext));
    this.patchProposalCreated = Boolean(
      this.finalSummaryOnly ||
      (resumeContext && /patch proposal .*applied|patch .*applied|补丁.*写入/i.test(resumeContext))
    );

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
      const resumePrompt = resumeContext
        ? `\n\nRecovered continuation context:\n${resumeContext}\n\nContinue from this recovered user action. Do not assume unapproved commands or patches already ran. Do not repeat already completed tool calls unless the context says they failed. If the context says an approval or verification is already pending in Review Dock, do not create a duplicate; summarize the waiting state or proceed only after a new user result is available.`
        : "";
      const initialUserPrompt = this.finalSummaryOnly
        ? `${taskDescription}\n${resumePrompt}\n\nThis is a final-summary-only continuation. Do not read files, search code, list files, run commands, or propose patches. Return the required strict done tool call now.`
        : `${taskDescription}\n${projectContext}\n\n${codeContext}${resumePrompt}\n\nBegin by reading relevant files and searching for related code. Then implement the changes.`;
      const patchChunkingPrompt = [
        "Patch chunking rule:",
        "- If you need to create or update multiple files, do NOT emit one huge apply_patch.",
        "- Emit at most 3 files in this apply_patch call.",
        "- Prefer the next coherent chunk only: package/config files first; then app source files; then tests/README.",
        "- After apply_patch, stop. Orbit will ask the user to review/apply it and then continue the run.",
        "- Your JSON must be complete. If content is long, split it across later apply_patch calls rather than risking truncation.",
      ].join("\n");

      const conversation: Array<{ role: "user" | "assistant"; content: string }> = [
        { role: "user", content: this.finalSummaryOnly ? initialUserPrompt : `${initialUserPrompt}\n\n${patchChunkingPrompt}` },
      ];

      // Main loop: Reasoning + Acting
      while (this.iteration < this.maxIterations && this.isRunning) {
        this.iteration++;
        this.callbacks.onIteration?.(
          this.iteration,
          conversation
            .slice(-4)
            .map((message) => `${message.role}: ${message.content.slice(0, 300)}`)
            .join("\n\n"),
        );

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

        const safeLlmResponse = stripFabricatedToolResults(llmResponse);
        conversation.push({ role: "assistant", content: safeLlmResponse || llmResponse });

        // Parse tool calls from response
        const toolCalls = this.parseToolCalls(safeLlmResponse || llmResponse);

        if (toolCalls.length === 0) {
          this.consecutiveInvalidToolResponses += 1;
          if (this.consecutiveInvalidToolResponses >= 3) {
            const detail = this.lastToolParseErrors.length > 0
              ? this.lastToolParseErrors.join("\n")
              : safeLlmResponse.slice(0, 900);
            const message = [
              "Agent could not produce a valid strict JSON tool call after 3 correction attempts.",
              "Nothing unsafe was executed.",
              "Suggested recovery: click Replan, reduce the task scope, or switch to a model with stronger tool-call behavior.",
              detail ? `Last model output/errors:\n${detail}` : "",
            ].filter(Boolean).join("\n");
            this.setPhase("error", message);
            this.callbacks.onError(message);
            this.isRunning = false;
            return message;
          }
          this.setPhase(
            "planning",
            this.lastToolParseErrors.length > 0
              ? `工具调用格式无效，已要求模型修正（第 ${this.consecutiveInvalidToolResponses} 次）。`
              : `模型没有返回工具调用，已要求模型继续使用工具（第 ${this.consecutiveInvalidToolResponses} 次）。`,
          );
          // No tool call found — might be pure text, ask LLM to use tools
          conversation.push({
            role: "user",
            content: this.lastToolParseErrors.length > 0
              ? [
                "Your tool call JSON was invalid and nothing was executed.",
                "Return exactly one complete JSON object and no prose.",
                "If you are proposing patches, include at most 3 small files in this apply_patch call.",
                "Do not include the whole project in one JSON response; split remaining files into later apply_patch calls after Review Dock.",
                `Errors:\n${this.lastToolParseErrors.join("\n")}`,
              ].join("\n")
              : "Please use a strict JSON tool call on one line to proceed. Available tools: read_file, search_code, list_files, apply_patch, run_command, ask_user.",
          });
          continue;
        }
        this.consecutiveInvalidToolResponses = 0;

        let allDone = false;
        let needsToolCorrection = false;
        const toolResults: Array<{ id: string; name: ToolName; result: string }> = [];

        for (const tc of toolCalls) {
          const toolName = tc.name as ToolName;
          if (toolName === "done") {
            const summary = typeof tc.params.summary === "string" ? tc.params.summary : "Task completed";
            const invalidDone = this.invalidDoneSummary(summary);
            if (invalidDone) {
              this.consecutiveInvalidToolResponses += 1;
              this.setPhase("planning", `完成声明缺少真实工具状态，已要求模型修正（第 ${this.consecutiveInvalidToolResponses} 次）。`);
              conversation.push({
                role: "user",
                content: invalidDone,
              });
              needsToolCorrection = true;
              break;
            }
            allDone = true;
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

          if (toolName === "run_command") {
            const invalid = invalidRunCommandMessage(tc.params);
            if (invalid) {
              toolResults.push({ id: tc.id, name: toolName, result: invalid });
              continue;
            }
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
                toolResults.push({
                  id: tc.id,
                  name: toolName,
                  result: [
                    "User denied this action.",
                    `Denied params: ${JSON.stringify(tc.params)}`,
                    "Do not retry the same action. Replan around the denial, fix the workspace/cwd/patch approach if relevant, and explain the corrected next step before requesting another risky action.",
                  ].join("\n"),
                });
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
              this.patchProposalCreated = true;
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

          if (toolName === "apply_patch") {
            this.setPhase("reviewing", "补丁提案正在等待你在审查台审查。");
            this.isRunning = false;
            return result;
          }
        }

        if (allDone) break;
        if (needsToolCorrection) continue;

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
          this.callbacks.onContextCompaction?.(this.contextCompaction);
          conversation.splice(1, conversation.length - 3);
          conversation.splice(1, 0, {
            role: "user",
            content: summary,
          });
        }
      }

      if (this.iteration >= this.maxIterations) {
        const detail = this.consecutiveInvalidToolResponses > 0
          ? `。连续 ${this.consecutiveInvalidToolResponses} 次没有可执行工具调用，请换更强模型或重新规划后再试。`
          : "";
        const message = `Exceeded max iterations (${this.maxIterations})${detail}`;
        this.setPhase("error", message);
        this.callbacks.onError(message);
        this.isRunning = false;
        return message;
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

  private invalidDoneSummary(summary: string): string | null {
    if (this.finalSummaryOnly) return null;
    if (!doneSummaryClaimsUncreatedPatch(summary, this.patchProposalCreated)) return null;
    return [
      "Invalid done tool call: you claimed patches, file changes, or Review Dock review, but Orbit has not received a real apply_patch tool call in this run.",
      "Nothing was written and no Review Dock patch exists.",
      "Return exactly one complete JSON tool call.",
      'If you need to propose files, use: {"tool":"apply_patch","params":{"patches":[{"path":"relative/file","oldContent":"...","newContent":"..."}]}}',
      "Keep apply_patch small: at most 3 files per call, then wait for Review Dock.",
      "Do not call done until Orbit returns a real apply_patch result and, after user verification, a real verification result.",
    ].join("\n");
  }
}
