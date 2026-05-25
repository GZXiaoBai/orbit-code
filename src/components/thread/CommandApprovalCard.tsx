import { useEffect, useState } from "react";
import {
  Play,
  ShieldAlert,
  ShieldCheck,
  Terminal as TermIcon,
  XCircle,
} from "lucide-react";
import type { PlanTask } from "../../domain/types";
import type { AppCopy } from "../../i18n/copy";
import { classifyCommand } from "../../runtime/approvalPolicy";
import { TerminalConsole } from "../TerminalConsole";

interface CommandApprovalCardProps {
  copy: AppCopy;
  pendingTask: PlanTask;
  terminalLogs: Record<string, string>;
  commandStatus: Record<string, { running: boolean; exitCode: number | null }>;
  onExecuteCommand?: (taskId: string, command: string) => void;
}

export function CommandApprovalCard({
  copy,
  pendingTask,
  terminalLogs,
  commandStatus,
  onExecuteCommand,
}: CommandApprovalCardProps) {
  const [approvalCommand, setApprovalCommand] = useState("");

  useEffect(() => {
    setApprovalCommand(pendingTask.verification[0] || "npm test");
  }, [pendingTask]);

  const approvalMode = approvalCommand ? classifyCommand(approvalCommand) : "ask";
  const risk = getRiskBadge(copy, approvalMode);
  const RiskIcon = risk.icon;

  function handleApprove() {
    if (onExecuteCommand && approvalCommand) {
      onExecuteCommand(pendingTask.id, approvalCommand);
    }
  }

  return (
    <section className="command-approval-section">
      <div className="approval-card-header">
        <div className="approval-card-title">
          <TermIcon size={16} />
          <span>{copy.approval.title}</span>
        </div>
        <span className={`risk-badge ${risk.className}`}>
          <RiskIcon size={12} />
          {risk.label}
        </span>
      </div>

      <div className="approval-card-body">
        <p className="task-intro">
          {copy.approval.introPrefix} <strong>{pendingTask.title}</strong>{copy.approval.introSuffix}
        </p>

        <div className="command-input-container">
          <input
            type="text"
            value={approvalCommand}
            onChange={(e) => setApprovalCommand(e.target.value)}
            disabled={commandStatus[pendingTask.id]?.running}
            placeholder={copy.approval.commandPlaceholder}
          />
        </div>

        {commandStatus[pendingTask.id]?.running || terminalLogs[pendingTask.id] ? (
          <TerminalConsole
            copy={copy}
            logs={terminalLogs[pendingTask.id] || ""}
            running={commandStatus[pendingTask.id]?.running ?? false}
            exitCode={commandStatus[pendingTask.id]?.exitCode ?? null}
          />
        ) : (
          <div className="approval-action-bar">
            <button
              className="deny-action-btn"
              onClick={() => alert(copy.approval.denyMessage)}
            >
              {copy.approval.deny}
            </button>
            <button
              className="approve-action-btn"
              onClick={handleApprove}
              disabled={approvalMode === "deny"}
            >
              <Play size={13} />
              {copy.approval.approve}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function getRiskBadge(copy: AppCopy, approvalMode: ReturnType<typeof classifyCommand>) {
  switch (approvalMode) {
    case "deny":
      return { label: copy.approval.dangerous, className: "risk-deny", icon: XCircle };
    case "allow_once":
      return { label: copy.approval.safe, className: "risk-safe", icon: ShieldCheck };
    case "ask":
    default:
      return { label: copy.approval.sensitive, className: "risk-warn", icon: ShieldAlert };
  }
}
