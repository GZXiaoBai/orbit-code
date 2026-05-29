import { Check, HelpCircle, X } from "lucide-react";
import { useState } from "react";
import type { QuestionAnswerInput, QuestionRequest } from "../../domain/questionRequest";
import type { AppCopy } from "../../i18n/copy";
import { Button, StatusBadge } from "../../ui/primitives";

export function QuestionQueue({
  copy,
  questions,
  onAnswer,
  onCancel,
}: {
  copy: AppCopy;
  questions: QuestionRequest[];
  onAnswer: (id: string, answer: string | QuestionAnswerInput) => void;
  onCancel: (id: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  if (questions.length === 0) return null;

  return (
    <>
      <div className="dock-queue-heading">
        <HelpCircle size={14} />
        <strong>{copy.workbench.questionsQueue}</strong>
      </div>
      {questions.map((question) => (
        <article key={question.id} className="approval-request-card question-request-card" data-review-focus="pending">
          <header>
            <div>
              <strong>{copy.workbench.agentQuestion}</strong>
              <small>{question.question}</small>
            </div>
            <StatusBadge tone="warning">{copy.workbench.waitingAnswer}</StatusBadge>
          </header>
          <textarea
            value={drafts[question.id] || ""}
            onChange={(event) => setDrafts((prev) => ({ ...prev, [question.id]: event.target.value }))}
            placeholder={copy.workbench.answerPlaceholder}
          />
          {question.options?.length ? (
            <div className="question-request-options">
              {question.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={selectedOptions[question.id] === option.id ? "selected" : ""}
                  onClick={() => setSelectedOptions((prev) => ({ ...prev, [question.id]: option.id }))}
                >
                  <span>{option.label}{option.recommended ? ` (${copy.workbench.recommended})` : ""}</span>
                  <small>{option.description}</small>
                </button>
              ))}
            </div>
          ) : null}
          <footer>
            <Button variant="ghost" onClick={() => onCancel(question.id)}>
              <X size={14} />
              {copy.workbench.cancelQuestion}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const selectedOptionId = selectedOptions[question.id];
                onAnswer(
                  question.id,
                  selectedOptionId
                    ? { selectedOptionId, answerType: "option" }
                    : { answer: drafts[question.id] || "", answerType: "freeform" },
                );
                setDrafts((prev) => ({ ...prev, [question.id]: "" }));
              }}
              disabled={!selectedOptions[question.id] && !(drafts[question.id] || "").trim()}
            >
              <Check size={14} />
              {copy.workbench.answerQuestion}
            </Button>
          </footer>
        </article>
      ))}
    </>
  );
}
