import type { AppCopy } from "../../i18n/copy";
import type { ImportedPlanState, ImportErrorState } from "../../state/useWorkspace";

interface PlanSummaryProps {
  copy: AppCopy;
  importedPlan: ImportedPlanState | null;
  importError: ImportErrorState | null;
}

export function PlanSummary({ copy, importedPlan, importError }: PlanSummaryProps) {
  const plan = importedPlan?.plan;

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
        <section className="plan-card">
          <div className="plan-card-header">
            <div>
              <h3>{copy.planImported}</h3>
              <span>{importedPlan.fileName}</span>
            </div>
            <strong>{plan.tasks.length}</strong>
          </div>

          <div className="plan-columns">
            <div>
              <h4>{copy.goals}</h4>
              <ul>
                {plan.goals.slice(0, 3).map((goal) => (
                  <li key={goal}>{goal}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4>{copy.planTasks}</h4>
              <ol>
                {plan.tasks.slice(0, 4).map((task) => (
                  <li key={task.id}>{task.title}</li>
                ))}
              </ol>
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
