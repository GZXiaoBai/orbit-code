import { CheckCircle2, Clock3, FileDiff, PlayCircle, XCircle } from "lucide-react";
import type { RunStep } from "../../domain/runSteps";
import type { AppCopy } from "../../i18n/copy";
import { localizedAgentEventName, localizedRuntimeText } from "./agentDisplayText";

interface RunStepListProps {
  copy: AppCopy;
  steps: RunStep[];
}

function iconForStep(step: RunStep) {
  if (step.status === "waiting") return <Clock3 size={14} />;
  if (step.status === "denied" || step.status === "failed" || step.status === "cancelled") return <XCircle size={14} />;
  if (step.kind === "patch") return <FileDiff size={14} />;
  if (step.status === "running") return <PlayCircle size={14} />;
  return <CheckCircle2 size={14} />;
}

export function RunStepList({ copy, steps }: RunStepListProps) {
  const visibleSteps = steps
    .filter((step) => step.status !== "done")
    .slice(-3);
  if (visibleSteps.length === 0) return null;

  return (
    <section className="run-step-list" aria-label={copy.workbench.agentRunSteps}>
      {visibleSteps.map((step) => (
        <article key={step.id} className={`run-step run-step-${step.status}`}>
          <span className="run-step-icon">{iconForStep(step)}</span>
          <div>
            <strong>{localizedAgentEventName(copy, step.title)}</strong>
            <p>{localizedRuntimeText(copy, step.detail)}</p>
          </div>
        </article>
      ))}
    </section>
  );
}
