import { TerminalSquare } from "lucide-react";
import type { TerminalRun } from "../../domain/terminalRun";
import type { AppCopy } from "../../i18n/copy";
import { EmptyState, StatusBadge } from "../../ui/primitives";
import { localizedRuntimeText } from "../../components/thread/agentDisplayText";

function terminalStatusLabel(copy: AppCopy, run: TerminalRun): string {
  if (run.status === "running") return copy.terminal.executing;
  if (run.status === "failed") return copy.terminal.failed;
  if (run.status === "cancelled") return copy.terminal.cancelled;
  return copy.terminal.ready;
}

function formatRunTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function terminalMeta(copy: AppCopy, run: TerminalRun): string {
  const started = formatRunTime(run.startedAt);
  const completed = formatRunTime(run.completedAt);
  const timeRange = started && completed && started !== completed ? `${started} - ${completed}` : started || completed || run.taskId;
  const exit = run.exitCode !== null
    ? copy.language === "中" ? `退出码 ${run.exitCode}` : `exit ${run.exitCode}`
    : "";
  return [timeRange, exit].filter(Boolean).join(" · ");
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
            {terminalMeta(copy, run)}
          </small>
          {run.reason ? <small className="terminal-run-reason">{localizedRuntimeText(copy, run.reason)}</small> : null}
          <pre>{localizedRuntimeText(copy, run.output || copy.terminal.waiting)}</pre>
        </section>
      ))}
    </div>
  );
}
