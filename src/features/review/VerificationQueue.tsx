import { Check, ShieldCheck, X } from "lucide-react";
import type { PermissionAction } from "../../domain/types";
import type { AppCopy } from "../../i18n/copy";
import type { ApprovalGrantScope, ApprovalRequest } from "../../state/useApprovalQueue";
import { Button, SelectMenu, StatusBadge } from "../../ui/primitives";
import { commandApprovalView } from "./reviewCardUtils";

export function VerificationQueue({
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
  if (approvals.length === 0) return null;
  const actionLabel = (action: PermissionAction) => copy.security[action] || action;
  const grantOptions: Array<{ value: ApprovalGrantScope; label: string; description?: string }> = [
    { value: "once", label: copy.workbench.grantOnce, description: copy.workbench.grantOnceDescription },
    { value: "session", label: copy.workbench.grantSession, description: copy.workbench.grantSessionDescription },
    { value: "project", label: copy.workbench.grantProject, description: copy.workbench.grantProjectDescription },
  ];

  return (
    <>
      <div className="dock-queue-heading">
        <ShieldCheck size={14} />
        <strong>{copy.workbench.verificationQueue}</strong>
      </div>
      {approvals.map((request) => {
        const view = commandApprovalView(request.params as Record<string, unknown>, request.reason || copy.workbench.pendingApproval);
        return (
          <article key={request.id} className="approval-request-card verification-request-card" data-review-focus="pending">
            <header>
              <div>
                <strong>{copy.workbench.verificationQueue}</strong>
                <small>{view.reason}</small>
              </div>
              <StatusBadge tone="warning">{copy.workbench.pendingApproval}</StatusBadge>
            </header>
            <div className="approval-command-summary">
              <code className="approval-command-line">{view.display}</code>
              <small>{copy.workbench.workspacePath}: {view.workspacePath || workspaceRoot || copy.workbench.noWorkspace}</small>
              {view.cwd ? <small>CWD: {view.cwd}</small> : null}
              <div className="approval-risk-list" aria-label={copy.workbench.permissionActions}>
                {view.actions.map((action) => (
                  <span key={action} className="approval-risk-chip">{actionLabel(action)}</span>
                ))}
              </div>
              <div className="approval-grant-row">
                <span>{copy.workbench.grantScope}</span>
                <SelectMenu
                  value={request.grantScope || "once"}
                  ariaLabel={copy.workbench.grantScope}
                  size="compact"
                  options={grantOptions}
                  onChange={(value) => onGrantScopeChange(request.id, value as ApprovalGrantScope)}
                />
              </div>
            </div>
            <footer>
              <Button variant="ghost" onClick={() => onResolve(request.id, false)}>
                <X size={14} />
                {copy.workbench.deny}
              </Button>
              <Button variant="primary" onClick={() => onResolve(request.id, true)}>
                <Check size={14} />
                {copy.workbench.approve}
              </Button>
            </footer>
          </article>
        );
      })}
    </>
  );
}
