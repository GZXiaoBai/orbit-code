import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, GitPullRequestArrow, X } from "lucide-react";
import type { ThreadPatch } from "../../domain/threadEvents";
import type { ThreadEvent } from "../../domain/threadEvents";
import type { AppCopy } from "../../i18n/copy";
import { DiffViewer } from "../../components/DiffViewer";
import { StatusBadge } from "../../ui/primitives";
import { localizedRuntimeName } from "../../components/thread/agentDisplayText";
import { patchApplySummary, patchSandboxSummary } from "../review/reviewCardUtils";

interface PatchReviewOverlayProps {
  copy: AppCopy;
  events: ThreadEvent[];
  workspacePath?: string;
  onApply: (eventId: string) => Promise<void> | void;
  onUpdatePatch: (eventId: string, path: string, updates: Partial<ThreadPatch>) => void;
}

export function PatchReviewOverlay({
  copy,
  events,
  workspacePath,
  onApply,
  onUpdatePatch,
}: PatchReviewOverlayProps) {
  const pendingEvents = useMemo(
    () => events.filter((event) => event.patches?.some((patch) => !patch.applied)),
    [events],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const activeEvent = pendingEvents[Math.min(activeIndex, Math.max(0, pendingEvents.length - 1))];

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, pendingEvents.length - 1)));
    if (pendingEvents.length > 0) setDismissed(false);
  }, [pendingEvents.length]);

  if (!activeEvent || dismissed) return null;

  const sandboxStatus = patchSandboxSummary(activeEvent);
  const applyStatus = patchApplySummary(activeEvent);
  const patches = activeEvent.patches || [];
  const canApply = patches.length > 0
    && patches.some((patch) => !patch.applied)
    && patches.every((patch) => patch.applied || (patch.sandboxStatus === "sandboxed" && patch.applyStatus !== "failed" && !patch.hasConflict));

  return (
    <div className="approval-overlay patch-review-overlay" role="presentation">
      <section
        className="approval-dialog patch-review-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="patch-review-dialog-title"
        tabIndex={-1}
      >
        <header className="approval-dialog-header">
          <div>
            <span className="approval-dialog-kicker">
              <GitPullRequestArrow size={16} />
              {copy.language === "中" ? "需要审查" : "Review required"}
            </span>
            <h2 id="patch-review-dialog-title">{localizedRuntimeName(copy, activeEvent.title)}</h2>
          </div>
          <div className="approval-dialog-pager" aria-label={copy.workbench.approvalPager}>
            <button type="button" onClick={() => setActiveIndex((current) => Math.max(0, current - 1))} disabled={activeIndex === 0} aria-label={copy.workbench.previousApproval}>
              <ChevronLeft size={18} />
            </button>
            <span>{Math.min(activeIndex + 1, pendingEvents.length)} of {pendingEvents.length}</span>
            <button type="button" onClick={() => setActiveIndex((current) => Math.min(pendingEvents.length - 1, current + 1))} disabled={activeIndex >= pendingEvents.length - 1} aria-label={copy.workbench.nextApproval}>
              <ChevronRight size={18} />
            </button>
          </div>
        </header>

        <div className="patch-review-overlay-meta">
          <StatusBadge tone={sandboxStatus === "failed" ? "danger" : sandboxStatus === "sandboxed" ? "success" : "warning"}>
            {copy.workbench.sandboxLabel} {copy.workbench.patchSandboxStatus[sandboxStatus]}
          </StatusBadge>
          <StatusBadge tone={applyStatus === "failed" ? "danger" : applyStatus === "applied" ? "success" : "warning"}>
            {copy.workbench.applyLabel} {copy.workbench.patchApplyStatus[applyStatus]}
          </StatusBadge>
          <span>{activeEvent.patches?.length || 0} {copy.language === "中" ? "个文件" : "files"}</span>
        </div>

        <div className="patch-review-overlay-body">
          <DiffViewer
            copy={copy}
            patches={patches}
            onApply={() => Promise.resolve(onApply(activeEvent.id))}
            workspacePath={workspacePath}
            eventId={activeEvent.id}
            onUpdatePatch={onUpdatePatch}
          />
        </div>

        <footer className="approval-dialog-footer">
          <button type="button" className="approval-dialog-deny" onClick={() => setDismissed(true)}>
            <X size={16} />
            <span>{copy.language === "中" ? "稍后" : "Later"}</span>
          </button>
          <button type="button" className="approval-dialog-approve" onClick={() => void onApply(activeEvent.id)} disabled={!canApply}>
            <Check size={16} />
            <span>{copy.diff.applyAll}</span>
          </button>
        </footer>
      </section>
    </div>
  );
}
