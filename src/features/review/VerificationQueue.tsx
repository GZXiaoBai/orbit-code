import { Check, ShieldCheck, X } from "lucide-react";
import type { AppCopy } from "../../i18n/copy";
import type { ApprovalRequest } from "../../state/useApprovalQueue";
import { Button, StatusBadge } from "../../ui/primitives";
import { commandApprovalView } from "./reviewCardUtils";

export function VerificationQueue({
  copy,
  approvals,
  workspaceRoot,
  onResolve,
}: {
  copy: AppCopy;
  approvals: ApprovalRequest[];
  workspaceRoot: string;
  onResolve: (id: string, approved: boolean) => void;
}) {
  if (approvals.length === 0) return null;

  return (
    <>
      <div className="dock-queue-heading">
        <ShieldCheck size={14} />
        <strong>{copy.workbench.verificationQueue}</strong>
      </div>
      {approvals.map((request) => {
        const view = commandApprovalView(request.params as Record<string, unknown>, request.reason || copy.workbench.pendingApproval);
        return (
          <article key={request.id} className="approval-request-card verification-request-card">
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
              <div className="approval-risk-list" aria-label="permission actions">
                {view.actions.map((action) => (
                  <span key={action} className="approval-risk-chip">{action}</span>
                ))}
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
