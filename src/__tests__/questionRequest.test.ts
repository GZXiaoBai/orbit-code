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
      kind: "text",
      source: "agent",
      question: "Which file should I edit?",
      status: "pending",
      createdAt: "t0",
    });
  });

  it("creates structured single choice questions with fallback descriptions", () => {
    const request = createQuestionRequest({
      taskId: "task-1",
      question: "Pick a path",
      options: [
        { id: "safe", label: "Safe", description: "Run verification first.", recommended: true },
        { id: "fast", label: "Fast", description: "" },
      ],
      allowFreeform: true,
      source: "plan",
    });

    expect(request).toMatchObject({
      kind: "singleChoice",
      source: "plan",
      allowFreeform: true,
      options: [
        { id: "safe", label: "Safe", description: "Run verification first.", recommended: true },
        { id: "fast", label: "Fast", description: "No additional details provided." },
      ],
    });
  });

  it("answers only pending questions", () => {
    const request = createQuestionRequest({ taskId: "task-1", question: "Continue?" });
    const answered = answerQuestionRequest([request], request.id, "Yes", "t1");

    expect(answered[0]).toMatchObject({
      status: "answered",
      answerType: "freeform",
      answer: "Yes",
      resolvedAt: "t1",
    });
  });

  it("answers structured questions with human-readable option context", () => {
    const request = createQuestionRequest({
      taskId: "task-1",
      question: "Continue?",
      options: [{ id: "safe", label: "Safe path", description: "Run tests before patching.", recommended: true }],
    });
    const answered = answerQuestionRequest([request], request.id, { selectedOptionId: "safe", answerType: "option" }, "t1");

    expect(answered[0]).toMatchObject({
      status: "answered",
      answerType: "option",
      selectedOptionId: "safe",
      answer: "Safe path: Run tests before patching.",
      resolvedAt: "t1",
    });
  });

  it("cancels pending questions", () => {
    const request = createQuestionRequest({ taskId: "task-1", question: "Continue?" });
    const cancelled = cancelQuestionRequest([request], request.id, "t1");

    expect(cancelled[0].status).toBe("cancelled");
    expect(cancelled[0].answerType).toBe("ignored");
    expect(cancelled[0].resolvedAt).toBe("t1");
  });

  it("recovers pending questions only when no live queue exists", () => {
    const recovered = createQuestionRequest({ taskId: "task-1", question: "Recovered?" });
    const live = createQuestionRequest({ taskId: "task-2", question: "Live?" });

    expect(recoverQuestionRequests([], [recovered])).toEqual([recovered]);
    expect(recoverQuestionRequests([live], [recovered])).toEqual([live]);
  });
});
