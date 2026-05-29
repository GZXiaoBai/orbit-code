import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowRight, Check, ShieldCheck, X } from "lucide-react";
import type { PermissionAction } from "../../domain/types";
import type { AppCopy } from "../../i18n/copy";
import type { ApprovalGrantScope, ApprovalRequest } from "../../state/useApprovalQueue";
import { SelectMenu, StatusBadge } from "../../ui/primitives";
import { commandApprovalView } from "../review/reviewCardUtils";

export function ApprovalOverlay({
  copy,
  approvals,
  workspaceRoot,
  onResolve,
  onGrantScopeChange,
}: {
  copy: AppCopy;
  approvals: ApprovalRequest[];
  workspaceRoot: string;
  onResolve: (id: string, approved: boolean) => void;
  onGrantScopeChange: (id: string, scope: ApprovalGrantScope) => void;
}) {
  const orderedApprovals = useMemo(
    () => [...approvals].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [approvals],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const activeApproval = orderedApprovals[Math.min(activeIndex, Math.max(0, orderedApprovals.length - 1))];

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, orderedApprovals.length - 1)));
  }, [orderedApprovals.length]);

  if (!activeApproval) return null;

  return (
    <div className="approval-overlay" role="presentation">
      <ApprovalDialog
        copy={copy}
        approval={activeApproval}
        workspaceRoot={workspaceRoot}
        index={Math.min(activeIndex, orderedApprovals.length - 1)}
        total={orderedApprovals.length}
        onPrevious={() => setActiveIndex((current) => Math.max(0, current - 1))}
        onNext={() => setActiveIndex((current) => Math.min(orderedApprovals.length - 1, current + 1))}
        onResolve={onResolve}
        onGrantScopeChange={onGrantScopeChange}
      />
    </div>
  );
}

function ApprovalDialog({
  copy,
  approval,
  workspaceRoot,
  index,
  total,
  onPrevious,
  onNext,
  onResolve,
  onGrantScopeChange,
}: {
  copy: AppCopy;
  approval: ApprovalRequest;
  workspaceRoot: string;
  index: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
  onResolve: (id: string, approved: boolean) => void;
  onGrantScopeChange: (id: string, scope: ApprovalGrantScope) => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const view = commandApprovalView(approval.params as Record<string, unknown>, approval.reason || copy.workbench.pendingApproval);
  const actionLabel = (action: PermissionAction) => copy.security[action] || action;
  const toolLabel = approval.tool === "run_command"
    ? copy.security.command
    : approval.tool === "apply_patch"
      ? copy.security.write
      : approval.tool;
  const grantOptions: Array<{ value: ApprovalGrantScope; label: string; description?: string }> = [
    { value: "once", label: copy.workbench.grantOnce, description: copy.workbench.grantOnceDescription },
    { value: "session", label: copy.workbench.grantSession, description: copy.workbench.grantSessionDescription },
    { value: "project", label: copy.workbench.grantProject, description: copy.workbench.grantProjectDescription },
  ];

  useEffect(() => {
    dialogRef.current?.focus();
  }, [approval.id]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest(".ui-select-menu")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onResolve(approval.id, false);
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onResolve(approval.id, true);
    }
    if (event.key === "ArrowLeft" && total > 1) {
      event.preventDefault();
      onPrevious();
    }
    if (event.key === "ArrowRight" && total > 1) {
      event.preventDefault();
      onNext();
    }
  };

  return (
    <div
      ref={dialogRef}
      className="approval-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-dialog-title"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <header className="approval-dialog-header">
        <div>
          <span className="approval-dialog-kicker">
            <ShieldCheck size={16} />
            {copy.workbench.authorizationRequired}
          </span>
          <h2 id="approval-dialog-title">{toolLabel}</h2>
        </div>
        <div className="approval-dialog-pager" aria-label={copy.workbench.approvalPager}>
          <button type="button" onClick={onPrevious} disabled={index === 0} aria-label={copy.workbench.previousApproval}>
            <ArrowLeft size={16} />
          </button>
          <span>{index + 1} of {total}</span>
          <button type="button" onClick={onNext} disabled={index >= total - 1} aria-label={copy.workbench.nextApproval}>
            <ArrowRight size={16} />
          </button>
        </div>
      </header>

      <div className="approval-dialog-body">
        <div className="approval-command-summary approval-dialog-summary">
          <StatusBadge tone="warning">{copy.workbench.pendingApproval}</StatusBadge>
          <small>{view.reason}</small>
          <code className="approval-command-line">{view.display}</code>
          <small>{copy.workbench.workspacePath}: {view.workspacePath || workspaceRoot || copy.workbench.noWorkspace}</small>
          {view.cwd ? <small>CWD: {view.cwd}</small> : null}
          {view.args.length > 0 ? <small>{view.args.length} {copy.workbench.argsCount}</small> : null}
          <div className="approval-risk-list" aria-label={copy.workbench.permissionActions}>
            {view.actions.map((action) => (
              <span key={action} className="approval-risk-chip">{actionLabel(action)}</span>
            ))}
          </div>
          <div className="approval-grant-row">
            <span>{copy.workbench.grantScope}</span>
            <SelectMenu
              value={approval.grantScope || "once"}
              ariaLabel={copy.workbench.grantScope}
              size="compact"
              options={grantOptions}
              onChange={(value) => onGrantScopeChange(approval.id, value as ApprovalGrantScope)}
            />
          </div>
        </div>
      </div>

      <footer className="approval-dialog-footer">
        <button type="button" className="approval-dialog-deny" onClick={() => onResolve(approval.id, false)}>
          <X size={16} />
          {copy.workbench.deny} <kbd>Esc</kbd>
        </button>
        <button type="button" className="approval-dialog-approve" onClick={() => onResolve(approval.id, true)}>
          <Check size={16} />
          {copy.workbench.approve}
          <kbd>Enter</kbd>
        </button>
      </footer>
    </div>
  );
}
