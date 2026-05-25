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
              <span>{copy.planTasks} {plan.tasks.length}</span>
              <span>{copy.acceptanceCriteria} {plan.acceptanceCriteria.length}</span>
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
