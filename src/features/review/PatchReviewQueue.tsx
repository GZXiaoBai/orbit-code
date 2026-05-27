import { GitPullRequestArrow } from "lucide-react";
import type { AgentEvent, AgentEventPatch } from "../../domain/agentEvents";
import type { AppCopy } from "../../i18n/copy";
import { DiffViewer } from "../../components/DiffViewer";
import { localizedAgentEventName, localizedRuntimeText } from "../../components/thread/agentDisplayText";
import { patchApplySummary, patchSandboxSummary } from "./reviewCardUtils";

export function PatchReviewQueue({
  copy,
  events,
  onApply,
  onUpdatePatch,
}: {
  copy: AppCopy;
  events: AgentEvent[];
  onApply: (eventId: string) => Promise<void> | void;
  onUpdatePatch: (eventId: string, path: string, updates: Partial<AgentEventPatch>) => void;
}) {
  if (events.length === 0) return null;

  return (
    <>
      <div className="dock-queue-heading">
        <GitPullRequestArrow size={14} />
        <strong>{copy.workbench.patchReview}</strong>
      </div>
      {events.map((event) => {
        const sandboxStatus = patchSandboxSummary(event);
        const applyStatus = patchApplySummary(event);
        const sandboxOutput = event.patches?.find((patch) => patch.sandboxOutput)?.sandboxOutput;
        const sandboxPath = event.patches?.find((patch) => patch.sandboxPath)?.sandboxPath;
        const compactSandboxPath = sandboxPath ? compactPath(sandboxPath) : "";
        return (
          <section key={event.id} className="dock-diff-card" data-review-focus="pending">
            <header>
              <div>
                <GitPullRequestArrow size={15} />
                <strong>{localizedAgentEventName(copy, event.name)}</strong>
              </div>
              <small>{event.timestamp}</small>
            </header>
            <div className="patch-status-row">
              <span className={`patch-status-chip ${sandboxStatus}`}>
                {copy.workbench.sandboxLabel} {copy.workbench.patchSandboxStatus[sandboxStatus]}
              </span>
              <span className={`patch-status-chip ${applyStatus}`}>
                {copy.workbench.applyLabel} {copy.workbench.patchApplyStatus[applyStatus]}
              </span>
            </div>
            {sandboxPath ? (
              <small className="patch-sandbox-path" title={sandboxPath}>
                {compactSandboxPath}
              </small>
            ) : null}
            {sandboxOutput ? <pre className="patch-sandbox-output">{localizedRuntimeText(copy, sandboxOutput)}</pre> : null}
            <DiffViewer
              copy={copy}
              patches={event.patches || []}
              onApply={() => Promise.resolve(onApply(event.id))}
              eventId={event.id}
              onUpdatePatch={onUpdatePatch}
            />
          </section>
        );
      })}
    </>
  );
}

function compactPath(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 4) return path;
  return `.../${parts.slice(-3).join("/")}`;
}
