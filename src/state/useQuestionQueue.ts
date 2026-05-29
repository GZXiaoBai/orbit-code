import { useCallback, useMemo, useRef, useState } from "react";
import {
  answerQuestionRequest,
  cancelQuestionRequest,
  createQuestionRequest,
  formatQuestionAnswer,
  type QuestionAnswerInput,
  type QuestionRequest,
  type QuestionRequestKind,
  type QuestionRequestSource,
  type QuestionOption,
} from "../domain/questionRequest";

export type QuestionCreatedCallback = (request: QuestionRequest) => void;

interface PendingQuestionResolver {
  resolve: (answer: string | null) => void;
}

export function recoverQuestionRequests(
  current: QuestionRequest[],
  recovered: QuestionRequest[],
): QuestionRequest[] {
  return current.length > 0 ? current : recovered;
}

export function useQuestionQueue(initialRequests: QuestionRequest[] = []) {
  const [requests, setRequests] = useState<QuestionRequest[]>(initialRequests);
  const resolversRef = useRef(new Map<string, PendingQuestionResolver>());
  const pendingQuestions = useMemo(() => requests.filter((request) => request.status === "pending"), [requests]);

  const requestQuestion = useCallback((
    question: string,
    taskId: string,
    scope?: {
      workspacePath?: string;
      threadId?: string;
      kind?: QuestionRequestKind;
      source?: QuestionRequestSource;
      options?: QuestionOption[];
      allowFreeform?: boolean;
    },
    onCreated?: QuestionCreatedCallback,
  ) => {
    const request = createQuestionRequest({
      taskId,
      question,
      workspacePath: scope?.workspacePath,
      threadId: scope?.threadId,
      kind: scope?.kind,
      source: scope?.source,
      options: scope?.options,
      allowFreeform: scope?.allowFreeform,
    });
    onCreated?.(request);
    setRequests((prev) => [request, ...prev]);

    return new Promise<string | null>((resolve) => {
      resolversRef.current.set(request.id, { resolve });
    });
  }, []);

  const answerQuestion = useCallback((id: string, input: string | QuestionAnswerInput) => {
    const request = requests.find((item) => item.id === id);
    const answer = request ? formatQuestionAnswer(request, input).answer : typeof input === "string" ? input : input.answer || "";
    const resolver = resolversRef.current.get(id);
    if (resolver) {
      resolver.resolve(answer);
      resolversRef.current.delete(id);
    }
    setRequests((prev) => answerQuestionRequest(prev, id, input));
    return Boolean(resolver);
  }, [requests]);

  const cancelQuestion = useCallback((id: string) => {
    const resolver = resolversRef.current.get(id);
    if (resolver) {
      resolver.resolve(null);
      resolversRef.current.delete(id);
    }
    setRequests((prev) => cancelQuestionRequest(prev, id));
    return Boolean(resolver);
  }, []);

  const cancelPendingQuestions = useCallback(() => {
    resolversRef.current.forEach(({ resolve }) => resolve(null));
    resolversRef.current.clear();
    setRequests((prev) =>
      prev.map((request) =>
        request.status === "pending"
          ? { ...request, status: "cancelled", resolvedAt: new Date().toISOString() }
          : request
      )
    );
  }, []);

  const recoverQuestions = useCallback((nextRequests: QuestionRequest[], replace = false) => {
    setRequests((prev) => replace ? nextRequests : recoverQuestionRequests(prev, nextRequests));
  }, []);

  return {
    questionRequests: requests,
    pendingQuestions,
    requestQuestion,
    answerQuestion,
    cancelQuestion,
    cancelPendingQuestions,
    recoverQuestions,
  };
}
