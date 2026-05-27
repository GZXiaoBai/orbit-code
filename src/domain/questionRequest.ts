export type QuestionRequestStatus = "pending" | "answered" | "cancelled";

export interface QuestionRequest {
  id: string;
  workspacePath?: string;
  threadId?: string;
  taskId: string;
  question: string;
  status: QuestionRequestStatus;
  answer?: string;
  createdAt: string;
  resolvedAt?: string;
}

export function createQuestionRequest(input: {
  workspacePath?: string;
  threadId?: string;
  taskId: string;
  question: string;
  at?: string;
}): QuestionRequest {
  const createdAt = input.at || new Date().toISOString();
  return {
    id: `question-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workspacePath: input.workspacePath,
    threadId: input.threadId,
    taskId: input.taskId,
    question: input.question,
    status: "pending",
    createdAt,
  };
}

export function answerQuestionRequest(
  requests: QuestionRequest[],
  id: string,
  answer: string,
  at = new Date().toISOString(),
): QuestionRequest[] {
  return requests.map((request) =>
    request.id === id && request.status === "pending"
      ? { ...request, status: "answered", answer, resolvedAt: at }
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
      ? { ...request, status: "cancelled", resolvedAt: at }
      : request
  );
}
