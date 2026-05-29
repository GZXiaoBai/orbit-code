export type QuestionRequestStatus = "pending" | "answered" | "cancelled";
export type QuestionRequestKind = "text" | "singleChoice";
export type QuestionRequestSource = "plan" | "agent";
export type QuestionAnswerType = "option" | "freeform" | "ignored";

export interface QuestionOption {
  id: string;
  label: string;
  description: string;
  recommended?: boolean;
}

export interface QuestionAnswerInput {
  answer?: string;
  selectedOptionId?: string;
  answerType?: QuestionAnswerType;
}

export interface QuestionRequest {
  id: string;
  workspacePath?: string;
  threadId?: string;
  taskId: string;
  kind: QuestionRequestKind;
  source: QuestionRequestSource;
  question: string;
  options?: QuestionOption[];
  allowFreeform?: boolean;
  status: QuestionRequestStatus;
  answerType?: QuestionAnswerType;
  selectedOptionId?: string;
  answer?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface CreateQuestionRequestInput {
  workspacePath?: string;
  threadId?: string;
  taskId: string;
  question: string;
  kind?: QuestionRequestKind;
  source?: QuestionRequestSource;
  options?: QuestionOption[];
  allowFreeform?: boolean;
  at?: string;
}

export const QUESTION_OPTION_DESCRIPTION_FALLBACK = "No additional details provided.";

export function normalizeQuestionOptions(input: unknown): QuestionOption[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item, index): QuestionOption | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const label = typeof record.label === "string" ? record.label.trim() : "";
      if (!label) return null;
      const rawId = typeof record.id === "string" ? record.id.trim() : "";
      const description = typeof record.description === "string" && record.description.trim()
        ? record.description.trim()
        : QUESTION_OPTION_DESCRIPTION_FALLBACK;
      return {
        id: rawId || `option-${index + 1}`,
        label,
        description,
        recommended: record.recommended === true,
      };
    })
    .filter((item): item is QuestionOption => Boolean(item));
}

export function createQuestionRequest(input: {
  workspacePath?: string;
  threadId?: string;
  taskId: string;
  question: string;
  kind?: QuestionRequestKind;
  source?: QuestionRequestSource;
  options?: QuestionOption[];
  allowFreeform?: boolean;
  at?: string;
}): QuestionRequest {
  const createdAt = input.at || new Date().toISOString();
  const options = normalizeQuestionOptions(input.options);
  const kind = input.kind || (options.length > 0 ? "singleChoice" : "text");
  return {
    id: `question-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workspacePath: input.workspacePath,
    threadId: input.threadId,
    taskId: input.taskId,
    kind,
    source: input.source || "agent",
    question: input.question,
    options: options.length > 0 ? options : undefined,
    allowFreeform: Boolean(input.allowFreeform),
    status: "pending",
    createdAt,
  };
}

export function formatQuestionAnswer(
  request: QuestionRequest,
  input: string | QuestionAnswerInput,
): { answer: string; answerType: QuestionAnswerType; selectedOptionId?: string } {
  if (typeof input === "string") {
    return {
      answer: input,
      answerType: request.kind === "singleChoice" ? "freeform" : "freeform",
    };
  }

  if (input.answerType === "ignored") {
    return {
      answer: input.answer || "User ignored/cancelled question.",
      answerType: "ignored",
      selectedOptionId: input.selectedOptionId,
    };
  }

  const option = request.options?.find((item) => item.id === input.selectedOptionId);
  if (option) {
    return {
      answer: option.description
        ? `${option.label}: ${option.description}`
        : option.label,
      answerType: "option",
      selectedOptionId: option.id,
    };
  }

  return {
    answer: input.answer || "",
    answerType: input.answerType || "freeform",
    selectedOptionId: input.selectedOptionId,
  };
}

export function answerQuestionRequest(
  requests: QuestionRequest[],
  id: string,
  input: string | QuestionAnswerInput,
  at = new Date().toISOString(),
): QuestionRequest[] {
  return requests.map((request) =>
    request.id === id && request.status === "pending"
      ? {
          ...request,
          ...formatQuestionAnswer(request, input),
          status: "answered",
          resolvedAt: at,
        }
      : request
  );
}

export function cancelQuestionRequest(
  requests: QuestionRequest[],
  id: string,
  at = new Date().toISOString(),
): QuestionRequest[] {
  return requests.map((request) =>
    request.id === id && request.status === "pending"
      ? { ...request, status: "cancelled", answerType: "ignored", resolvedAt: at }
      : request
  );
}
