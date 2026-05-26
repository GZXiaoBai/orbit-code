import type { AppCopy } from "../../i18n/copy";
import type { ImportedPlanState, ImportErrorState } from "../../state/useWorkspace";

interface PlanSummaryProps {
  copy: AppCopy;
  importedPlan: ImportedPlanState | null;
  importError: ImportErrorState | null;
}

export function PlanSummary({ copy, importedPlan, importError }: PlanSummaryProps) {
  const plan = importedPlan?.plan;
  const nextTask = plan?.tasks.find((task) => task.status !== "done" && task.status !== "verified") || plan?.tasks[0];

  return (
    <>
      {importError ? (
        <section className="plan-card error">
          <h3>{copy.invalidPlan}</h3>
          <ul>
            {importError.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {plan ? (
        <section className="plan-card plan-card-compact">
          <div className="plan-card-header">
            <div>
              <span>{copy.planImported}</span>
              <h3>{plan.title}</h3>
            </div>
            <strong>{plan.tasks.length}</strong>
          </div>

          <div className="plan-compact-body">
            <p>{nextTask?.title || plan.goals[0] || importedPlan.fileName}</p>
            <div className="plan-compact-meta">
              <span>{copy.goals} {plan.goals.length}</span>
              <span>{copy.constraints} {plan.constraints.length}</span>
              <span>{copy.workbench.questionsAndGates} {plan.decisionQuestions?.length || 0}</span>
              <span>{copy.planTasks} {plan.tasks.length}</span>
              <span>{copy.acceptanceCriteria} {plan.acceptanceCriteria.length}</span>
              <span>{copy.risks} {plan.risks.length}</span>
            </div>
            <div className="plan-detail-grid">
              <PlanPreviewList title={copy.goals} items={plan.goals} />
              <PlanPreviewList title={copy.constraints} items={plan.constraints} />
              <PlanQuestionList title={copy.workbench.questionsAndGates} questions={plan.decisionQuestions || []} />
              <PlanPreviewList title={copy.planTasks} items={plan.tasks.map((task) => task.title)} limit={4} />
              <PlanPreviewList title={copy.acceptanceCriteria} items={plan.acceptanceCriteria} />
              <PlanPreviewList title={copy.risks} items={plan.risks} />
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}

function PlanPreviewList({ title, items, limit = 3 }: { title: string; items: string[]; limit?: number }) {
  const visible = items.filter(Boolean).slice(0, limit);
  if (visible.length === 0) return null;

  return (
    <section className="plan-preview-list">
      <h4>{title}</h4>
      <ul>
        {visible.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function PlanQuestionList({
  title,
  questions,
}: {
  title: string;
  questions: Array<{ question: string; recommended?: string; options: string[] }>;
}) {
  const visible = questions.filter((item) => item.question).slice(0, 2);
  if (visible.length === 0) return null;

  return (
    <section className="plan-preview-list plan-question-list">
      <h4>{title}</h4>
      {visible.map((item, index) => (
        <div key={`${item.question}-${index}`} className="plan-question-item">
          <strong>{item.question}</strong>
          {item.recommended ? <span>{item.recommended}</span> : null}
          {item.options.length > 0 ? (
            <ul>
              {item.options.slice(0, 3).map((option) => (
                <li key={option}>{option}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </section>
  );
}
