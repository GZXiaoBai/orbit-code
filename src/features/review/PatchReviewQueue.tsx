import { GitPullRequestArrow } from "lucide-react";
import type { AgentEvent, AgentEventPatch } from "../../domain/agentEvents";
import type { AppCopy } from "../../i18n/copy";
import { DiffViewer } from "../../components/DiffViewer";
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
        return (
          <section key={event.id} className="dock-diff-card">
            <header>
              <div>
                <GitPullRequestArrow size={15} />
                <strong>{event.name}</strong>
              </div>
              <small>{event.timestamp}</small>
            </header>
            <div className="patch-status-row">
              <span className={`patch-status-chip ${sandboxStatus}`}>Sandbox {sandboxStatus}</span>
              <span className={`patch-status-chip ${applyStatus}`}>Apply {applyStatus}</span>
            </div>
            {sandboxPath ? <small className="patch-sandbox-path">{sandboxPath}</small> : null}
            {sandboxOutput ? <pre className="patch-sandbox-output">{sandboxOutput}</pre> : null}
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
