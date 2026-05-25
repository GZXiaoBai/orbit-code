import { describe, expect, it } from "vitest";
import {
  answerQuestionRequest,
  cancelQuestionRequest,
  createQuestionRequest,
} from "../domain/questionRequest";
import { recoverQuestionRequests } from "../state/useQuestionQueue";

describe("question request reducer", () => {
  it("creates a pending blocking question", () => {
    const request = createQuestionRequest({ taskId: "task-1", question: "Which file should I edit?", at: "t0" });

    expect(request).toMatchObject({
      taskId: "task-1",
      question: "Which file should I edit?",
      status: "pending",
      createdAt: "t0",
    });
  });

  it("answers only pending questions", () => {
    const request = createQuestionRequest({ taskId: "task-1", question: "Continue?" });
    const answered = answerQuestionRequest([request], request.id, "Yes", "t1");

    expect(answered[0]).toMatchObject({
      status: "answered",
      answer: "Yes",
      resolvedAt: "t1",
    });
  });

  it("cancels pending questions", () => {
    const request = createQuestionRequest({ taskId: "task-1", question: "Continue?" });
    const cancelled = cancelQuestionRequest([request], request.id, "t1");

    expect(cancelled[0].status).toBe("cancelled");
    expect(cancelled[0].resolvedAt).toBe("t1");
  });

  it("recovers pending questions only when no live queue exists", () => {
    const recovered = createQuestionRequest({ taskId: "task-1", question: "Recovered?" });
    const live = createQuestionRequest({ taskId: "task-2", question: "Live?" });

    expect(recoverQuestionRequests([], [recovered])).toEqual([recovered]);
    expect(recoverQuestionRequests([live], [recovered])).toEqual([live]);
  });
});
