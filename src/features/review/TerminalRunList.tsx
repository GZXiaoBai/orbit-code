import { TerminalSquare } from "lucide-react";
import type { TerminalRun } from "../../domain/terminalRun";
import type { AppCopy } from "../../i18n/copy";
import { EmptyState, StatusBadge } from "../../ui/primitives";

function terminalStatusLabel(copy: AppCopy, run: TerminalRun): string {
  if (run.status === "running") return copy.terminal.executing;
  if (run.status === "failed") return copy.terminal.failed;
  if (run.status === "cancelled") return copy.terminal.cancelled;
  return copy.terminal.ready;
}

export function TerminalRunList({
  copy,
  runs,
}: {
  copy: AppCopy;
  runs: TerminalRun[];
}) {
  if (runs.length === 0) {
    return <EmptyState icon={<TerminalSquare size={22} />} title={copy.terminal.waiting.trim()} />;
  }

  return (
    <div className="dock-terminal-list">
      {runs.map((run) => (
        <section key={run.id} className="dock-terminal">
          <header>
            <TerminalSquare size={15} />
            <strong>{[run.command, ...run.args].join(" ")}</strong>
            <StatusBadge tone={run.status === "running" ? "warning" : run.exitCode === 0 ? "success" : run.status === "failed" ? "danger" : "neutral"}>
              {terminalStatusLabel(copy, run)}
            </StatusBadge>
          </header>
          <small className="terminal-run-reason">
            {run.startedAt ? `${run.startedAt}${run.completedAt ? ` - ${run.completedAt}` : ""}` : run.taskId}
            {run.exitCode !== null ? ` · exit ${run.exitCode}` : ""}
          </small>
          {run.reason ? <small className="terminal-run-reason">{run.reason}</small> : null}
          <pre>{run.output || copy.terminal.waiting}</pre>
        </section>
      ))}
    </div>
  );
}
