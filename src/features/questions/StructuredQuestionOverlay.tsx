import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CornerDownLeft, Info } from "lucide-react";
import type { QuestionAnswerInput, QuestionRequest } from "../../domain/questionRequest";
import { QUESTION_OPTION_DESCRIPTION_FALLBACK } from "../../domain/questionRequest";
import type { AppCopy } from "../../i18n/copy";

export function StructuredQuestionOverlay({
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
  const orderedQuestions = useMemo(
    () => [...questions].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [questions],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const activeQuestion = orderedQuestions[Math.min(activeIndex, Math.max(0, orderedQuestions.length - 1))];

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, orderedQuestions.length - 1)));
  }, [orderedQuestions.length]);

  if (!activeQuestion) return null;

  return (
    <div className="structured-question-overlay" role="presentation">
      <QuestionDialog
        copy={copy}
        question={activeQuestion}
        index={Math.min(activeIndex, orderedQuestions.length - 1)}
        total={orderedQuestions.length}
        onPrevious={() => setActiveIndex((current) => Math.max(0, current - 1))}
        onNext={() => setActiveIndex((current) => Math.min(orderedQuestions.length - 1, current + 1))}
        onAnswer={onAnswer}
        onCancel={onCancel}
      />
    </div>
  );
}

function QuestionDialog({
  copy,
  question,
  index,
  total,
  onPrevious,
  onNext,
  onAnswer,
  onCancel,
}: {
  copy: AppCopy;
  question: QuestionRequest;
  index: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
  onAnswer: (id: string, answer: string | QuestionAnswerInput) => void;
  onCancel: (id: string) => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const options = question.options || [];
  const freeformIndex = question.allowFreeform ? options.length : -1;
  const [selectedIndex, setSelectedIndex] = useState(() => Math.max(0, options.findIndex((option) => option.recommended)));
  const [draft, setDraft] = useState("");
  const [tooltipId, setTooltipId] = useState<string | null>(null);
  const hasChoices = options.length > 0;
  const choiceCount = options.length + (question.allowFreeform ? 1 : 0);
  const selectedOption = selectedIndex >= 0 && selectedIndex < options.length ? options[selectedIndex] : null;
  const freeformSelected = selectedIndex === freeformIndex;

  useEffect(() => {
    const recommendedIndex = Math.max(0, options.findIndex((option) => option.recommended));
    setSelectedIndex(recommendedIndex);
    setDraft("");
  }, [question.id, options]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, [question.id]);

  const commit = () => {
    if (selectedOption) {
      onAnswer(question.id, { selectedOptionId: selectedOption.id, answerType: "option" });
      return;
    }
    if (freeformSelected || !hasChoices) {
      const answer = draft.trim();
      if (answer) onAnswer(question.id, { answer, answerType: "freeform" });
    }
  };

  const moveSelection = (delta: number) => {
    if (choiceCount <= 0) return;
    setSelectedIndex((current) => (current + delta + choiceCount) % choiceCount);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const isTextEntry = target?.tagName === "TEXTAREA" || target?.tagName === "INPUT";
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel(question.id);
      return;
    }
    if (!isTextEntry && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      moveSelection(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (!isTextEntry && event.key === "ArrowLeft" && total > 1) {
      event.preventDefault();
      onPrevious();
      return;
    }
    if (!isTextEntry && event.key === "ArrowRight" && total > 1) {
      event.preventDefault();
      onNext();
      return;
    }
    if (!isTextEntry && /^[1-9]$/.test(event.key)) {
      const next = Number(event.key) - 1;
      if (next < choiceCount) {
        event.preventDefault();
        setSelectedIndex(next);
      }
      return;
    }
    if (!isTextEntry && event.key === "Enter") {
      event.preventDefault();
      commit();
    }
  };

  const canContinue = Boolean(selectedOption || ((freeformSelected || !hasChoices) && draft.trim().length > 0));

  return (
    <div
      ref={dialogRef}
      className="structured-question-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="structured-question-title"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <header className="structured-question-header">
        <h2 id="structured-question-title">{question.question}</h2>
        <div className="structured-question-pager" aria-label={copy.workbench.questionPager}>
          <button type="button" onClick={onPrevious} disabled={index === 0} aria-label={copy.workbench.previousQuestion}>
            <ArrowLeft size={16} />
          </button>
          <span>{index + 1} of {total}</span>
          <button type="button" onClick={onNext} disabled={index >= total - 1} aria-label={copy.workbench.nextQuestion}>
            <ArrowRight size={16} />
          </button>
        </div>
      </header>

      <div className="structured-question-options" role={hasChoices ? "radiogroup" : undefined}>
        {options.map((option, optionIndex) => {
          const selected = optionIndex === selectedIndex;
          const description = option.description || QUESTION_OPTION_DESCRIPTION_FALLBACK;
          const infoId = `question-option-info-${question.id}-${option.id}`;
          return (
            <button
              key={option.id}
              type="button"
              className={`structured-question-option ${selected ? "selected" : ""}`}
              role="radio"
              aria-checked={selected}
              aria-describedby={tooltipId === infoId ? infoId : undefined}
              onClick={() => setSelectedIndex(optionIndex)}
              onDoubleClick={() => onAnswer(question.id, { selectedOptionId: option.id, answerType: "option" })}
            >
              <span className="structured-question-number">{optionIndex + 1}.</span>
              <span className="structured-question-label">
                {option.label}{option.recommended ? ` (${copy.workbench.recommended})` : ""}
              </span>
              <span
                className="structured-question-info"
                tabIndex={0}
                role="button"
                aria-label={description}
                onFocus={() => setTooltipId(infoId)}
                onBlur={() => setTooltipId((current) => current === infoId ? null : current)}
                onMouseEnter={() => setTooltipId(infoId)}
                onMouseLeave={() => setTooltipId((current) => current === infoId ? null : current)}
                onClick={(event) => {
                  event.stopPropagation();
                  setTooltipId((current) => current === infoId ? null : infoId);
                }}
              >
                <Info size={14} />
                {tooltipId === infoId ? (
                  <span id={infoId} className="structured-question-tooltip" role="tooltip">
                    {description}
                  </span>
                ) : null}
              </span>
              {selected ? (
                <span className="structured-question-arrows" aria-hidden="true">
                  <ArrowUp size={15} />
                  <ArrowDown size={15} />
                </span>
              ) : null}
            </button>
          );
        })}

        {question.allowFreeform ? (
          <button
            type="button"
            className={`structured-question-option structured-question-freeform ${freeformSelected ? "selected" : ""}`}
            role={hasChoices ? "radio" : undefined}
            aria-checked={hasChoices ? freeformSelected : undefined}
            onClick={() => setSelectedIndex(freeformIndex)}
          >
            <span className="structured-question-number">{options.length + 1}.</span>
            <span className="structured-question-label">{copy.workbench.freeformQuestionOption}</span>
          </button>
        ) : null}

        {(!hasChoices || freeformSelected) ? (
          <textarea
            className="structured-question-textarea"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={copy.workbench.answerPlaceholder}
            autoFocus={!hasChoices}
          />
        ) : null}
      </div>

      <footer className="structured-question-footer">
        <button type="button" className="structured-question-ignore" onClick={() => onCancel(question.id)}>
          {copy.workbench.ignoreQuestion} <kbd>Esc</kbd>
        </button>
        <button type="button" className="structured-question-continue" onClick={commit} disabled={!canContinue}>
          {copy.workbench.continueQuestion}
          <span><CornerDownLeft size={14} /></span>
        </button>
      </footer>
    </div>
  );
}
