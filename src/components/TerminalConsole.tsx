import { useEffect, useRef } from "react";
import { Terminal, ShieldCheck, ShieldAlert } from "lucide-react";
import type { AppCopy } from "../i18n/copy";

interface TerminalConsoleProps {
  copy: AppCopy;
  logs: string;
  running: boolean;
  exitCode: number | null;
}

export function TerminalConsole({ copy, logs, running, exitCode }: TerminalConsoleProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // 日志输出时自动触底滚动
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="terminal-box">
      <header className="terminal-header">
        <div className="terminal-title-area">
          <Terminal size={13} className="term-icon" />
          <span>{copy.terminal.title}</span>
        </div>
        <div className="terminal-status-badge">
          {running ? (
            <span className="badge running">
              <span className="badge-blink" />
              {copy.terminal.executing}
            </span>
          ) : exitCode === 0 ? (
            <span className="badge success">
              <ShieldCheck size={11} style={{ marginRight: 3 }} />
              EXIT CODE 0
            </span>
          ) : exitCode !== null ? (
            <span className="badge error">
              <ShieldAlert size={11} style={{ marginRight: 3 }} />
              ERROR {exitCode}
            </span>
          ) : (
            <span className="badge ready">{copy.terminal.ready}</span>
          )}
        </div>
      </header>

      <div className="terminal-body-scroll" ref={containerRef}>
        <pre className="terminal-log-pre">
          {logs ? logs : copy.terminal.waiting}
          {running && <span className="terminal-cursor">█</span>}
        </pre>
      </div>
    </div>
  );
}
