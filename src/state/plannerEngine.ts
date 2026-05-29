import type { CodingPlan, PlanDecisionQuestion, ReasoningEffort } from "../domain/types";
import type { ToolParams } from "../domain/agentLoop";
import { isToolAllowedInMode } from "../domain/agentModeContract";
import { parseToolEnvelopes } from "../domain/agentToolEnvelope";
import { executeToolCall, buildToolResultPrompt, buildToolsPrompt } from "../runtime/toolRegistry";
import { callLLMApi, cleanJsonOutput, optionsForReasoningEffort, PLANNER_SYSTEM_PROMPT, type LLMProvider } from "../services/llmService";

export interface PlannerEngineInput {
  providerId: LLMProvider;
  model: string;
  baseUrl?: string;
  reasoningEffort: ReasoningEffort;
  request: string;
  workspacePath?: string;
  onAskUser?: (question: string, params: ToolParams) => Promise<string | null>;
  onToolDeniedByMode?: (tool: string, params: ToolParams) => void;
}

export type PlannerResult =
  | { kind: "planDraft"; plan: CodingPlan }
  | { kind: "message"; message: string };

function normalizeGeneratedDecisionQuestions(input: unknown): PlanDecisionQuestion[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item): PlanDecisionQuestion | null => {
      if (typeof item === "string") {
        const question = item.trim();
        return question ? { question, options: [] } : null;
      }
      if (!item || typeof item !== "object") return null;
      const value = item as { question?: unknown; recommended?: unknown; options?: unknown };
      const question = typeof value.question === "string" ? value.question.trim() : "";
      if (!question) return null;
      const options = Array.isArray(value.options)
        ? value.options.filter((option): option is string => typeof option === "string" && option.trim().length > 0)
        : [];
      return {
        question,
        recommended: typeof value.recommended === "string" ? value.recommended.trim() || undefined : undefined,
        options,
      };
    })
    .filter((question): question is PlanDecisionQuestion => Boolean(question));
}

function codingPlanFromGeneratedJson(parsedPlan: any): CodingPlan {
  return {
    version: "1",
    title: parsedPlan.title || "Planner 工作计划草案",
    goals: Array.isArray(parsedPlan.goals) ? parsedPlan.goals : [],
    constraints: Array.isArray(parsedPlan.constraints) ? parsedPlan.constraints : [],
    tasks: (Array.isArray(parsedPlan.tasks) ? parsedPlan.tasks : []).map((task: any, index: number) => ({
      id: task.id || `planner-task-${index}-${Date.now()}`,
      title: task.title || "开发步骤",
      description: task.description || task.details || task.detail || "按计划完成对应修改，并说明影响范围和验证方式。",
      status: "queued" as const,
      dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn : [],
      filesHint: Array.isArray(task.filesHint) ? task.filesHint : [],
      verification: Array.isArray(task.verification) ? task.verification : ["npm test -- --run"],
    })),
    decisionQuestions: normalizeGeneratedDecisionQuestions(parsedPlan.decisionQuestions || parsedPlan.decision_questions || parsedPlan.questions),
    acceptanceCriteria: Array.isArray(parsedPlan.acceptanceCriteria) ? parsedPlan.acceptanceCriteria : [],
    risks: Array.isArray(parsedPlan.risks) ? parsedPlan.risks : [],
    references: Array.isArray(parsedPlan.references) ? parsedPlan.references : [],
  };
}

export function summarizePlanDraft(plan: CodingPlan): string {
  const goals = plan.goals.slice(0, 4).map((goal) => `- ${goal}`).join("\n");
  const tasks = plan.tasks.slice(0, 6).map((task, index) => `${index + 1}. ${task.title}`).join("\n");
  const questions = (plan.decisionQuestions || []).slice(0, 3).map((question) => `- ${question.question}`).join("\n");
  return [
    `Plan 草案：${plan.title}`,
    goals ? `\n目标：\n${goals}` : "",
    tasks ? `\n任务：\n${tasks}` : "",
    questions ? `\n待确认：\n${questions}` : "",
    "\n这是只读 Planner 输出，尚未进入 Build，也没有执行命令或生成补丁。采纳后会成为 Coding Plan 并切换到 Build。",
  ].filter(Boolean).join("\n");
}

export async function runPlannerTurn(input: PlannerEngineInput): Promise<PlannerResult> {
  return new PlannerEngine().runTurn(input);
}

export class PlannerEngine {
  async runTurn(input: PlannerEngineInput): Promise<PlannerResult> {
    const options = optionsForReasoningEffort(input.reasoningEffort);
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [{
      role: "user",
      content: [
        "You are in Orbit Plan mode. This is a read-only tool loop.",
        "Use read_file, list_files, search_code, and ask_user if needed before drafting the plan.",
        "Forbidden tools must not be used: run_command, propose_patch, apply_patch, verification, write.",
        "When enough context is gathered, output the final JSON object matching the planner schema, not a patch and not a command result.",
        "",
        buildToolsPrompt("plan"),
        "",
        input.request,
      ].join("\n"),
    }];

    for (let iteration = 0; iteration < 6; iteration++) {
      const userPrompt = messages
        .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
        .join("\n\n---\n\n");
      const output = await callLLMApi(
        input.providerId,
        input.model,
        PLANNER_SYSTEM_PROMPT,
        userPrompt,
        input.baseUrl,
        undefined,
        options,
      );
      const cleaned = cleanJsonOutput(output);
      const envelopes = parseToolEnvelopes(cleaned).envelopes;
      if (envelopes.length === 0) {
        const parsed = JSON.parse(cleaned);
        return { kind: "planDraft", plan: codingPlanFromGeneratedJson(parsed) };
      }

      const toolResults: Array<{ id: string; name: any; result: string }> = [];
      for (const [index, envelope] of envelopes.entries()) {
        const toolName = envelope.tool;
        if (!isToolAllowedInMode("plan", toolName as any)) {
          input.onToolDeniedByMode?.(toolName, envelope.params);
          toolResults.push({
            id: `planner-tool-${iteration}-${index}`,
            name: toolName,
            result: `Tool denied by Plan mode: ${toolName}. Use read_file/list_files/search_code/ask_user/done_plan only.`,
          });
          continue;
        }
        if (toolName === "done_plan") {
          const summary = typeof envelope.params.summary === "string" ? envelope.params.summary : "";
          return { kind: "planDraft", plan: codingPlanFromGeneratedJson({ title: "Planner 工作计划草案", goals: [summary], tasks: [], acceptanceCriteria: [], risks: [] }) };
        }
        if (toolName === "ask_user") {
          const question = typeof envelope.params.question === "string" ? envelope.params.question : "Continue?";
          const answer = input.onAskUser ? await input.onAskUser(question, envelope.params) : null;
          toolResults.push({
            id: `planner-tool-${iteration}-${index}`,
            name: "ask_user",
            result: answer ? `User answered: ${answer}` : "User question was not answered in this planning turn. Continue with explicit assumptions.",
          });
          continue;
        }
        const result = await executeToolCall(toolName as any, envelope.params, { workspacePath: input.workspacePath });
        toolResults.push({ id: `planner-tool-${iteration}-${index}`, name: toolName as any, result });
      }
      messages.push({ role: "assistant", content: cleaned });
      messages.push({ role: "user", content: buildToolResultPrompt(toolResults, "plan") });
    }

    return { kind: "message", message: "Planner reached its read-only iteration limit before producing a plan draft." };
  }
}
