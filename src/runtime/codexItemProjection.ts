import { createActionRequiredEvent, type ActionRequiredEvent } from "../domain/actionRequired";
import type {
  CodexInspectableItem,
  CodexInspectorModel,
  CodexItem,
  CodexRuntimeProjection,
  CodexRuntimeStatus,
  CodexThread,
  CodexThreadViewModel,
  CodexTurn,
  CodexUsageSummary,
  RuntimeOperation,
} from "../domain/codex";
import { createRuntimeMessage, type RuntimeMessage } from "../domain/runtimeMessages";
import type { RunStep } from "../domain/runSteps";
import type { TerminalRun } from "../domain/terminalRun";
import { createThreadEvent, type ThreadEvent, type ThreadPatch, type ThreadQuestionOption } from "../domain/threadEvents";
import type { CodingPlan } from "../domain/types";

function eventKindForItem(item: CodexItem): ThreadEvent["kind"] {
  if (item.kind === "reasoning") return "reasoningSummary";
  if (item.kind === "planDraft") return "planDraft";
  if (item.kind === "command") return "commandExecution";
  if (item.kind === "fileEdit") return "patchProposal";
  if (item.kind === "approval") return "approvalRequest";
  if (item.kind === "question") return "question";
  if (item.kind === "terminal") return "terminalRun";
  if (item.kind === "error") return "error";
  return item.kind === "user" ? "userMessage" : "agentMessage";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringField(record: Record<string, unknown>, key: string, fallback = ""): string {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
}

function boolField(record: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
}

function numberField(record: Record<string, unknown>, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return fallback;
}

const USAGE_INPUT_KEYS = [
  "inputTokens",
  "input_tokens",
  "promptTokens",
  "prompt_tokens",
  "promptTokenCount",
  "prompt_eval_count",
] as const;

const USAGE_OUTPUT_KEYS = [
  "outputTokens",
  "output_tokens",
  "completionTokens",
  "completion_tokens",
  "candidatesTokenCount",
  "eval_count",
] as const;

const USAGE_TOTAL_KEYS = [
  "totalTokens",
  "total_tokens",
  "totalTokenCount",
  "tokens",
] as const;

function usageScore(record: Record<string, unknown>): number {
  return [
    ...USAGE_INPUT_KEYS,
    ...USAGE_OUTPUT_KEYS,
    ...USAGE_TOTAL_KEYS,
  ].filter((key) => typeof record[key] === "number" && Number.isFinite(record[key])).length;
}

function usageTotalValue(record: Record<string, unknown>): number {
  return numberField(record, [...USAGE_TOTAL_KEYS], numberField(record, [...USAGE_INPUT_KEYS]) + numberField(record, [...USAGE_OUTPUT_KEYS]));
}

function collectNestedUsageRecords(value: unknown, output: Record<string, unknown>[], depth = 0) {
  if (depth > 5 || !value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  if (usageScore(record) > 0) output.push(record);
  Object.values(record).forEach((nested) => collectNestedUsageRecords(nested, output, depth + 1));
}

function usageRecordFromContainers(record: Record<string, unknown>): Record<string, unknown> {
  const info = asRecord(record.info);
  const candidates = [
    asRecord(record.usage),
    asRecord(record.totalTokenUsage),
    asRecord(record.total_token_usage),
    asRecord(record.totalUsage),
    asRecord(record.total_usage),
    asRecord(record.tokenUsage),
    asRecord(record.token_usage),
    asRecord(record.usageSnapshot),
    asRecord(record.usage_snapshot),
    asRecord(record.lastTokenUsage),
    asRecord(record.last_token_usage),
    asRecord(info.totalTokenUsage),
    asRecord(info.total_token_usage),
    asRecord(info.totalUsage),
    asRecord(info.total_usage),
    asRecord(info.tokenUsage),
    asRecord(info.token_usage),
    asRecord(info.usage),
    asRecord(info.lastTokenUsage),
    asRecord(info.last_token_usage),
    record,
  ];
  collectNestedUsageRecords(record, candidates);
  return candidates
    .filter((candidate) => Object.keys(candidate).length > 0)
    .sort((a, b) => usageScore(b) - usageScore(a) || usageTotalValue(b) - usageTotalValue(a))[0] || {};
}

function itemDate(value: string): Date {
  if (value.startsWith("unix-ms:")) {
    const millis = Number(value.slice("unix-ms:".length));
    if (Number.isFinite(millis)) return new Date(millis);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function itemTimestamp(value: string): string {
  return itemDate(value).toLocaleTimeString();
}

function toneForItem(item: CodexItem): CodexInspectableItem["tone"] {
  if (item.status === "failed" || item.status === "denied" || item.kind === "error") return "danger";
  if (item.status === "pending" || item.status === "running") return "warning";
  if (item.kind === "usage" || item.kind === "reasoning") return "info";
  return "success";
}

function toInspectableItem(item: CodexItem): CodexInspectableItem {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    text: item.text,
    status: item.status,
    threadId: item.threadId,
    turnId: item.turnId,
    createdAt: item.createdAt,
    timestamp: itemTimestamp(item.createdAt),
    metadata: item.metadata,
    tone: toneForItem(item),
  };
}

function codexPatches(item: CodexItem): ThreadPatch[] | undefined {
  const rawPatches = Array.isArray(item.metadata?.patches) ? item.metadata?.patches : [];
  const patches = rawPatches.length > 0
    ? rawPatches
    : Array.isArray(item.metadata?.changes)
      ? item.metadata.changes.map((raw) => {
        const change = asRecord(raw);
        const diff = stringField(change, "diff");
        return {
          path: stringField(change, "path"),
          oldContent: "",
          newContent: diff,
          applied: item.status === "completed",
          sandboxStatus: "sandboxed",
          applyStatus: item.status === "failed" ? "failed" : item.status === "completed" ? "applied" : "pending",
          sandboxOutput: diff,
        };
      })
      : [];
  if (patches.length === 0) return undefined;
  return patches.map((raw) => {
    const patch = asRecord(raw);
    return {
      path: stringField(patch, "path"),
      oldContent: stringField(patch, "oldContent", stringField(patch, "old_content")),
      newContent: stringField(patch, "newContent", stringField(patch, "new_content")),
      applied: boolField(patch, "applied"),
      sandboxStatus: stringField(patch, "sandboxStatus", stringField(patch, "sandbox_status", "sandboxed")) as ThreadPatch["sandboxStatus"],
      sandboxPath: stringField(patch, "sandboxPath", stringField(patch, "sandbox_path")),
      sandboxOutput: stringField(patch, "sandboxOutput", stringField(patch, "sandbox_output")),
      applyStatus: stringField(patch, "applyStatus", stringField(patch, "apply_status", "pending")) as ThreadPatch["applyStatus"],
      hasConflict: boolField(patch, "hasConflict", boolField(patch, "has_conflict")),
      conflictContent: stringField(patch, "conflictContent", stringField(patch, "conflict_content")),
      resolvedContent: stringField(patch, "resolvedContent", stringField(patch, "resolved_content")),
      conflictResolved: boolField(patch, "conflictResolved", boolField(patch, "conflict_resolved")),
    };
  });
}

function codexQuestionOptions(item: CodexItem): ThreadQuestionOption[] {
  const options = Array.isArray(item.metadata?.options) ? item.metadata?.options : [];
  return options.map((raw, index) => {
    const option = asRecord(raw);
    return {
      id: stringField(option, "id", `option-${index + 1}`),
      label: stringField(option, "label", String(raw)),
      description: stringField(option, "description"),
      recommended: boolField(option, "recommended"),
    };
  });
}

function eventStatusForItem(item: CodexItem): ThreadEvent["status"] {
  if (item.status === "running") return "thinking";
  if (item.status === "pending") return "idle";
  if (item.status === "failed" || item.status === "denied") return "done";
  return "done";
}

export function codexItemsToThreadEvents(items: CodexItem[]): ThreadEvent[] {
  return items.map((item) => createThreadEvent({
    id: item.id,
    kind: eventKindForItem(item),
    threadId: item.threadId,
    runSessionId: item.turnId,
    role: item.kind === "user" ? "planner" : item.kind === "terminal" ? "verifier" : "coder",
    status: eventStatusForItem(item),
    title: item.title,
    message: item.text,
    createdAt: item.createdAt,
    timestamp: itemTimestamp(item.createdAt),
    patches: item.kind === "fileEdit" ? codexPatches(item) : undefined,
    planDraft: item.kind === "planDraft" ? item.metadata?.plan as CodingPlan | undefined : undefined,
    question: item.kind === "question" ? {
      requestId: item.id,
      question: item.text,
      status: item.status === "completed" ? "answered" : item.status === "denied" || item.status === "failed" ? "cancelled" : "pending",
      answer: typeof item.metadata?.answer === "string" ? item.metadata.answer : undefined,
      selectedOptionId: typeof item.metadata?.selectedOptionId === "string" ? item.metadata.selectedOptionId : undefined,
      options: codexQuestionOptions(item),
    } : undefined,
    approval: item.kind === "approval" ? {
      requestId: item.id,
      tool: typeof item.metadata?.tool === "string" ? item.metadata.tool : "codex_approval",
      params: asRecord(item.metadata?.params) as any,
      status: item.status === "denied" ? "denied" : item.status === "completed" ? "approved" : "pending",
      reason: typeof item.metadata?.reason === "string" ? item.metadata.reason : undefined,
    } : undefined,
  }));
}

export function codexItemsToRuntimeMessages(items: CodexItem[]): RuntimeMessage[] {
  return items
    .filter((item) => item.kind === "user" || item.kind === "assistant" || item.kind === "reasoning" || item.kind === "planDraft" || item.kind === "error")
    .map((item) => createRuntimeMessage({
      id: item.id,
      role: item.kind === "user" ? "user" : "assistant",
      threadId: item.threadId,
      at: item.createdAt,
      status: item.status === "running" || item.status === "pending" ? "streaming" : item.status === "failed" ? "failed" : "completed",
      parts: item.kind === "error"
        ? [{ type: "error", message: item.text }]
        : [{ type: item.kind === "reasoning" ? "thinking" : "text", text: item.text }],
    }));
}

export function codexItemsToActions(items: CodexItem[]): ActionRequiredEvent[] {
  return items
    .filter((item) => item.kind === "approval" || item.kind === "question")
    .map((item) => createActionRequiredEvent({
      id: item.id,
      kind: item.kind === "question" ? "question" : (typeof item.metadata?.actionKind === "string" ? item.metadata.actionKind : "command") as ActionRequiredEvent["kind"],
      tool: item.kind === "approval" ? String(item.metadata?.tool || "run_command") : undefined,
      params: asRecord(item.metadata?.params) as any,
      question: item.kind === "question" ? item.text : undefined,
      options: item.kind === "question" ? codexQuestionOptions(item).map((option) => ({
        id: option.id,
        label: option.label,
        description: option.description,
        recommended: option.recommended,
      })) : undefined,
      allowFreeform: item.kind === "question" ? item.metadata?.allowFreeform !== false : undefined,
      title: item.title,
      description: item.text,
      threadId: item.threadId,
      runSessionId: item.turnId,
      status: item.status === "pending" || item.status === "running" ? "pending" : item.status === "denied" ? "denied" : "resolved",
      createdAt: item.createdAt,
    }));
}

export function codexItemsToTerminalRuns(items: CodexItem[]): TerminalRun[] {
  return items
    .filter((item) => item.kind === "terminal")
    .map((item) => ({
      id: item.id,
      taskId: item.turnId || item.id,
      threadId: item.threadId,
      command: String(item.metadata?.command || item.title || "codex"),
      args: Array.isArray(item.metadata?.args) ? item.metadata.args.map(String) : [],
      reason: item.title,
      output: item.text,
      outputTail: item.text,
      status: item.status === "running" || item.status === "pending" ? "running" : item.status === "failed" ? "failed" : "done",
      exitCode: typeof item.metadata?.exitCode === "number" ? item.metadata.exitCode : null,
      startedAt: item.createdAt,
      completedAt: item.status === "running" || item.status === "pending" ? undefined : item.createdAt,
    }));
}

export function codexItemsToRunSteps(items: CodexItem[]): RunStep[] {
  return items
    .filter((item) => item.kind !== "usage")
    .map((item) => ({
    id: `codex:${item.id}`,
    kind: item.kind === "command" ? "command" : item.kind === "fileEdit" ? "patch" : item.kind === "terminal" ? "terminal" : item.kind === "approval" || item.kind === "question" ? "approval" : "agent",
    status: item.status === "running" ? "running" : item.status === "pending" ? "waiting" : item.status === "failed" ? "failed" : item.status === "denied" ? "denied" : "done",
    title: item.title,
    detail: item.text,
    approvalId: item.kind === "approval" || item.kind === "question" ? item.id : undefined,
    eventId: item.id,
    createdAt: item.createdAt,
  }));
}

function usageFromItem(item: CodexItem): CodexUsageSummary {
  const metadata = asRecord(item.metadata);
  const usage = usageRecordFromContainers(metadata);
  const inputTokens = numberField(usage, [...USAGE_INPUT_KEYS]);
  const outputTokens = numberField(usage, [...USAGE_OUTPUT_KEYS]);
  const totalTokens = numberField(usage, [...USAGE_TOTAL_KEYS], inputTokens + outputTokens);
  return { inputTokens, outputTokens, totalTokens };
}

function sumUsage(items: CodexItem[]): CodexUsageSummary {
  return items
    .filter((item) => item.kind === "usage")
    .map(usageFromItem)
    .reduce<CodexUsageSummary>((total, usage) => ({
      inputTokens: total.inputTokens + usage.inputTokens,
      outputTokens: total.outputTokens + usage.outputTokens,
      totalTokens: total.totalTokens + usage.totalTokens,
    }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
}

function operationIsThreadRunning(operation: RuntimeOperation | null | undefined): boolean {
  if (!operation || (operation.status !== "running" && operation.status !== "starting")) return false;
  return operation.kind === "plan" || operation.kind === "build" || operation.kind === "interrupt";
}

export function buildCodexThreadViewModel(input: {
  status: CodexRuntimeStatus;
  thread: CodexThread | null;
  activeTurn: CodexTurn | null;
  activeOperation?: RuntimeOperation | null;
  items: CodexItem[];
  error?: string;
}): CodexThreadViewModel {
  const inspectable = input.items.map(toInspectableItem);
  const messages = inspectable.filter((item) =>
    item.kind === "user"
    || item.kind === "assistant"
    || item.kind === "reasoning"
    || item.kind === "planDraft"
    || item.kind === "fileEdit"
    || item.kind === "error"
  );
  const planDrafts = inspectable.filter((item) => item.kind === "planDraft");
  const pendingActions = inspectable.filter((item) =>
    (item.kind === "approval" || item.kind === "question")
    && (item.status === "pending" || item.status === "running")
  );
  return {
    status: input.status,
    thread: input.thread,
    activeTurn: input.activeTurn,
    activeOperation: input.activeOperation,
    messages,
    planDrafts,
    pendingActions,
    running: operationIsThreadRunning(input.activeOperation),
    failed: input.status === "error" || input.activeTurn?.status === "failed" || inspectable.some((item) => item.kind === "error"),
    interrupted: input.activeTurn?.status === "interrupted",
    error: input.error,
    itemCount: input.items.length,
  };
}

export function buildCodexInspectorModel(items: CodexItem[]): CodexInspectorModel {
  const inspectable = items.map(toInspectableItem);
  const events = codexItemsToThreadEvents(items);
  const terminalRuns = codexItemsToTerminalRuns(items);
  const actions = inspectable.filter((item) => item.kind === "approval" || item.kind === "question");
  const edits = inspectable.filter((item) => item.kind === "fileEdit");
  const terminals = inspectable.filter((item) => item.kind === "terminal");
  const errors = inspectable.filter((item) => item.kind === "error" || item.status === "failed");
  const patchEvents = events.filter((event) => event.patches && event.patches.length > 0).reverse();
  return {
    items: inspectable,
    actions,
    approvals: inspectable.filter((item) => item.kind === "approval"),
    questions: inspectable.filter((item) => item.kind === "question"),
    edits,
    terminals,
    reasoning: inspectable.filter((item) => item.kind === "reasoning"),
    errors,
    usageItems: inspectable.filter((item) => item.kind === "usage"),
    patchEvents,
    terminalRuns,
    usage: sumUsage(items),
    counts: {
      actions: actions.length,
      pendingActions: actions.filter((item) => item.status === "pending" || item.status === "running").length,
      edits: edits.length,
      terminal: terminals.length,
      errors: errors.length,
      changes: edits.length,
    },
  };
}

export function buildCodexProjection(input: {
  status: CodexRuntimeStatus;
  thread: CodexThread | null;
  activeTurn: CodexTurn | null;
  activeOperation?: RuntimeOperation | null;
  items: CodexItem[];
  error?: string;
}): CodexRuntimeProjection {
  const events = codexItemsToThreadEvents(input.items);
  const terminalRuns = codexItemsToTerminalRuns(input.items);
  return {
    ...input,
    threadModel: buildCodexThreadViewModel(input),
    inspectorModel: buildCodexInspectorModel(input.items),
    events,
    runtimeMessages: codexItemsToRuntimeMessages(input.items),
    actions: codexItemsToActions(input.items),
    terminalRuns,
    runSteps: codexItemsToRunSteps(input.items),
  };
}
