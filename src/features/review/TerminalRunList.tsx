import { TerminalSquare } from "lucide-react";
import type { TerminalRun } from "../../domain/terminalRun";
import type { AppCopy } from "../../i18n/copy";
import { EmptyState, StatusBadge } from "../../ui/primitives";
import { localizedRuntimeText } from "../../components/thread/agentDisplayText";

export function terminalStatusLabel(copy: AppCopy, run: TerminalRun): string {
  if (run.recoveredState === "unknown-needs-continue") {
    return copy.language === "中" ? "需手动继续" : "Needs continue";
  }
  if (run.status === "running") return copy.terminal.executing;
  if (run.exitCode !== null && run.exitCode !== 0) return copy.terminal.failed;
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
  const cancelled = formatRunTime(run.cancelledAt);
  const timeRange = started && completed && started !== completed ? `${started} - ${completed}` : started || completed || run.taskId;
  const exit = run.exitCode !== null
    ? copy.language === "中" ? `退出码 ${run.exitCode}` : `exit ${run.exitCode}`
    : "";
  const cwd = run.cwd
    ? copy.language === "中" ? `目录 ${run.cwd}` : `cwd ${run.cwd}`
    : "";
  const process = run.processId
    ? copy.language === "中" ? `进程 ${run.processId}` : `process ${run.processId}`
    : "";
  const session = run.sessionId
    ? copy.language === "中" ? `会话 ${run.sessionId}` : `session ${run.sessionId}`
    : "";
  const recovered = run.recoveredState
    ? copy.language === "中" ? `恢复状态 ${run.recoveredState}` : `recovered ${run.recoveredState}`
    : "";
  const cancelledAt = cancelled
    ? copy.language === "中" ? `取消 ${cancelled}` : `cancelled ${cancelled}`
    : "";
  return [timeRange, cwd, exit, process, session, cancelledAt, recovered].filter(Boolean).join(" · ");
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
  const orderedRuns = [...runs].sort((a, b) => {
    const aTime = a.completedAt || a.startedAt || "";
    const bTime = b.completedAt || b.startedAt || "";
    return bTime.localeCompare(aTime);
  });

  return (
    <div className="dock-terminal-list">
      {orderedRuns.map((run, index) => (
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
          <details className="terminal-output-details" open={index === 0 || run.status === "running"}>
            <summary>{copy.language === "中" ? "命令输出" : "Command output"}</summary>
            <pre>{localizedRuntimeText(copy, run.output || run.outputTail || copy.terminal.waiting)}</pre>
          </details>
        </section>
      ))}
    </div>
  );
}
