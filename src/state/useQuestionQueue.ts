import { useCallback, useRef, useState } from "react";
import {
  answerQuestionRequest,
  cancelQuestionRequest,
  createQuestionRequest,
  type QuestionRequest,
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

  const requestQuestion = useCallback((
    question: string,
    taskId: string,
    onCreated?: QuestionCreatedCallback,
  ) => {
    const request = createQuestionRequest({ taskId, question });
    onCreated?.(request);
    setRequests((prev) => [request, ...prev]);

    return new Promise<string | null>((resolve) => {
      resolversRef.current.set(request.id, { resolve });
    });
  }, []);

  const answerQuestion = useCallback((id: string, answer: string) => {
    const resolver = resolversRef.current.get(id);
    if (resolver) {
      resolver.resolve(answer);
      resolversRef.current.delete(id);
    }
    setRequests((prev) => answerQuestionRequest(prev, id, answer));
    return Boolean(resolver);
  }, []);

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

  const recoverQuestions = useCallback((nextRequests: QuestionRequest[]) => {
    setRequests((prev) => recoverQuestionRequests(prev, nextRequests));
  }, []);

  return {
    questionRequests: requests,
    pendingQuestions: requests.filter((request) => request.status === "pending"),
    requestQuestion,
    answerQuestion,
    cancelQuestion,
    cancelPendingQuestions,
    recoverQuestions,
  };
}
