import { CheckCircle2, CircleAlert, Clock3, FileText, MessageSquare, Play, RefreshCw, TerminalSquare, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { AgentLoopPhase, ToolCall } from "../../domain/agentLoop";
import { buildThreadEvents, type ThreadEvent } from "../../domain/threadEvents";
import type { AppCopy } from "../../i18n/copy";
import type { AgentEvent } from "../../state/useWorkspace";
import { compactRuntimeTextForTimeline, localizedAgentEventName } from "./agentDisplayText";

interface AgentTimelineProps {
  copy: AppCopy;
  agentEvents: AgentEvent[];
  agentLoopPhase?: AgentLoopPhase;
  agentLoopRunning?: boolean;
  agentLoopToolCalls?: ToolCall[];
  onStartAgentLoop?: () => void;
  onContinueAgentRun?: () => void;
  canContinueAgentRun?: boolean;
  onCancelAgentLoop?: () => void;
  onRestartCollaboration?: () => void;
  onApplyEventPatch?: (eventId: string) => Promise<void>;
  onRefinePatch?: (eventId: string, feedback: string) => Promise<void> | void;
  onUpdatePatch?: (eventId: string, path: string, updates: Partial<any>) => void;
  streamingContent?: string;
  streamingActive?: boolean;
}

export function AgentTimeline({
  copy,
  agentEvents,
  agentLoopPhase,
  agentLoopRunning,
  agentLoopToolCalls = [],
  onStartAgentLoop,
  onContinueAgentRun,
  canContinueAgentRun,
  onCancelAgentLoop,
  onRestartCollaboration,
  onApplyEventPatch: _onApplyEventPatch,
  onRefinePatch: _onRefinePatch,
  onUpdatePatch: _onUpdatePatch,
  streamingContent,
  streamingActive,
}: AgentTimelineProps) {
  const hasActions = Boolean(
    onStartAgentLoop ||
    onContinueAgentRun ||
    onCancelAgentLoop ||
    onRestartCollaboration ||
    agentLoopRunning ||
    streamingActive,
  );
  if (agentEvents.length === 0 && !hasActions) return null;
  const threadEvents = buildThreadEvents(agentEvents);
  const visibleEvents = compactThreadEvents(threadEvents);
  const hiddenCount = Math.max(0, threadEvents.length - visibleEvents.length);
  const localizedPhase = agentLoopPhase
    ? copy.workbench.agentPhases[agentLoopPhase as keyof typeof copy.workbench.agentPhases] || agentLoopPhase
    : "";

  return (
    <section className="agent-collaboration-timeline">
      <div className="timeline-container">
        {hiddenCount > 0 ? (
          <div className="timeline-history-note">
            <Clock3 size={14} />
            {copy.language === "中" ? `已收起 ${hiddenCount} 条低优先级运行记录` : `${hiddenCount} low-priority run records hidden`}
          </div>
        ) : null}
        {visibleEvents.map((evt) => {
          const display = getThreadEventDisplay(copy, evt);
          return (
            <div
              key={evt.id}
              className={`timeline-node message-stream-item message-${display.variant} role-${evt.role} status-${evt.status} thread-event-${evt.kind}`}
            >
              {display.variant === "tool" ? (
                <ToolEventRow copy={copy} event={evt} icon={display.icon} label={display.label} />
              ) : (
                <MessageBubble copy={copy} event={evt} label={display.label} isUser={display.variant === "user"} />
              )}
            </div>
          );
        })}
        {streamingActive && (
          <div className="timeline-node message-stream-item message-assistant role-coder status-thinking">
            <article className="assistant-message">
              <div className="message-author">{copy.thread.thinking}</div>
              <div className="node-message streaming-text">
                {streamingContent ? compactRuntimeTextForTimeline(copy, streamingContent, 420) : "..."}
                <span className="cursor-blink">|</span>
              </div>
            </article>
          </div>
        )}
        {agentLoopToolCalls.length > 0 ? (
          <LiveAgentOperations copy={copy} toolCalls={agentLoopToolCalls} />
        ) : null}
      </div>

      <div className="collaboration-header message-stream-controls">
        <h3>{copy.thread.flowTitle}</h3>
        <div className="timeline-actions">
          {agentLoopRunning && (
            <span className="agent-loop-status">
              {copy.thread.agentLoopStatus}: {localizedPhase}
            </span>
          )}
          {onContinueAgentRun && canContinueAgentRun && (
            <button className="restart-flow-btn agent-loop-btn continue-agent-btn" onClick={onContinueAgentRun} title={copy.thread.continueAgentTitle}>
              <Play size={12} />
              <span>{copy.thread.continueAgent}</span>
            </button>
          )}
          {onStartAgentLoop && !agentLoopRunning && !canContinueAgentRun && (
            <button className="restart-flow-btn agent-loop-btn" onClick={onStartAgentLoop} title={copy.thread.startAgentLoopTitle}>
              <Play size={12} />
              <span>{copy.thread.agentLoop}</span>
            </button>
          )}
          {onCancelAgentLoop && agentLoopRunning && (
            <button className="restart-flow-btn cancel-flow-btn" onClick={onCancelAgentLoop} title={copy.thread.cancelAgentLoopTitle}>
              <XCircle size={12} />
              <span>{copy.thread.cancel}</span>
            </button>
          )}
          {onRestartCollaboration && (
            <button className="restart-flow-btn" onClick={onRestartCollaboration} title={copy.thread.restartTitle}>
              <RefreshCw size={12} />
              <span>{copy.thread.restart}</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function LiveAgentOperations({ copy, toolCalls }: { copy: AppCopy; toolCalls: ToolCall[] }) {
  const compactCalls = compactToolCalls(toolCalls);
  const exploredFiles = new Set(
    toolCalls
      .filter((call) => call.name === "read_file")
      .map((call) => typeof call.params.path === "string" ? call.params.path : "")
      .filter(Boolean),
  );
  const activeCall = [...toolCalls].reverse().find((call) => call.status === "running" || call.status === "pending") || compactCalls[compactCalls.length - 1];
  const summary = activeCall
    ? summarizeLiveToolCall(copy, activeCall, exploredFiles.size)
    : copy.workbench.agentOperations;

  return (
    <div className="agent-live-operations">
      <details>
        <summary>
          <span className={`live-operation-dot status-${activeCall?.status || "done"}`} />
          <strong>{summary}</strong>
          <span>{copy.workbench.agentOperationDetails}</span>
        </summary>
        <div className="live-operation-list">
          {compactCalls.map((call) => (
            <article key={call.id} className={`live-operation-item status-${call.status}`}>
              <header>
                <strong>{localizedToolName(copy, call.name)}</strong>
                <small>{call.status}</small>
              </header>
              <pre>{formatToolCallDetails(call)}</pre>
              {call.error ? <p className="live-operation-error">{call.error}</p> : null}
              {call.result ? <p>{compactRuntimeTextForTimeline(copy, call.result, 220)}</p> : null}
            </article>
          ))}
        </div>
      </details>
    </div>
  );
}

function compactToolCalls(toolCalls: ToolCall[]): ToolCall[] {
  const byId = new Map<string, ToolCall>();
  for (const call of toolCalls) byId.set(call.id, { ...byId.get(call.id), ...call });
  return Array.from(byId.values()).slice(-6);
}

function localizedToolName(copy: AppCopy, name: ToolCall["name"]): string {
  const zh: Record<ToolCall["name"], string> = {
    read_file: "读取文件",
    search_code: "搜索代码",
    list_files: "列出文件",
    run_command: "运行命令",
    apply_patch: "提出补丁",
    ask_user: "询问用户",
    done: "完成",
  };
  const en: Record<ToolCall["name"], string> = {
    read_file: "Read file",
    search_code: "Search code",
    list_files: "List files",
    run_command: "Run command",
    apply_patch: "Propose patch",
    ask_user: "Ask user",
    done: "Done",
  };
  return copy.language === "中" ? zh[name] : en[name];
}

function summarizeLiveToolCall(copy: AppCopy, call: ToolCall, exploredFileCount: number): string {
  if (exploredFileCount > 0 && ["read_file", "search_code", "list_files"].includes(call.name)) {
    return copy.workbench.agentOperationFiles.replace("{count}", String(exploredFileCount));
  }
  if (call.name === "apply_patch") {
    const patches = Array.isArray(call.params.patches) ? call.params.patches : [];
    const target = patches.length > 0
      ? `${patches.length} ${copy.workbench.filesCount}`
      : typeof call.params.path === "string" ? call.params.path : copy.workbench.patchReview;
    return copy.workbench.agentOperationEditing.replace("{target}", target);
  }
  if (call.name === "run_command") {
    const command = typeof call.params.command === "string" ? call.params.command : "command";
    const args = Array.isArray(call.params.args) ? call.params.args.filter((arg): arg is string => typeof arg === "string") : [];
    return copy.workbench.agentOperationCommand.replace("{target}", [command, ...args].join(" "));
  }
  if (call.name === "ask_user") return copy.workbench.agentOperationWaiting;
  return `${copy.workbench.agentOperations}: ${localizedToolName(copy, call.name)}`;
}

function formatToolCallDetails(call: ToolCall): string {
  const details: string[] = [`${call.status}`];
  if (call.name === "run_command") {
    const command = typeof call.params.command === "string" ? call.params.command : "";
    const args = Array.isArray(call.params.args) ? call.params.args.filter((arg): arg is string => typeof arg === "string") : [];
    details.push([command, ...args].filter(Boolean).join(" "));
  } else if (call.name === "apply_patch") {
    const patches = Array.isArray(call.params.patches) ? call.params.patches : [];
    const files = patches
      .map((patch) => typeof patch === "object" && patch && "path" in patch ? String((patch as { path?: unknown }).path || "") : "")
      .filter(Boolean);
    details.push(files.length ? files.join(", ") : "Patch proposal");
  } else if (call.name === "read_file") {
    details.push(typeof call.params.path === "string" ? call.params.path : "File read");
  } else if (call.name === "search_code") {
    details.push(typeof call.params.query === "string" ? call.params.query : "Code search");
  } else if (call.name === "ask_user") {
    details.push(typeof call.params.question === "string" ? call.params.question : "Waiting for user input");
  }
  return details.filter(Boolean).join("\n");
}

function MessageBubble({
  copy,
  event,
  label,
  isUser,
}: {
  copy: AppCopy;
  event: ThreadEvent;
  label: string;
  isUser: boolean;
}) {
  return (
    <article className={isUser ? "user-message" : "assistant-message"}>
      {!isUser ? <div className="message-author">{label}</div> : null}
      <div className="node-message" dangerouslySetInnerHTML={{ __html: renderAgentMessage(copy, event.message) }} />
      <footer className="message-meta">
        {isUser ? <span>{label}</span> : null}
        <span>{event.timestamp}</span>
      </footer>
    </article>
  );
}

function ToolEventRow({
  copy,
  event,
  icon,
  label,
}: {
  copy: AppCopy;
  event: ThreadEvent;
  icon: ReactNode;
  label: string;
}) {
  return (
    <div className="message-tool-row">
      <span className="tool-row-line" aria-hidden="true" />
      <span className="tool-row-body">
        <span className="tool-row-icon">{icon}</span>
        <span className="tool-row-copy">
          <strong>{label}</strong>
          <span dangerouslySetInnerHTML={{ __html: renderAgentMessage(copy, summarizeToolEvent(copy, event)) }} />
        </span>
        {event.patches && event.patches.length > 0 ? (
          <span className="tool-row-pill">
            {event.patches.length} {copy.workbench.filesCount}
          </span>
        ) : null}
      </span>
      <span className="tool-row-line" aria-hidden="true" />
    </div>
  );
}

function getThreadEventDisplay(copy: AppCopy, event: ThreadEvent): {
  variant: "assistant" | "user" | "tool";
  label: string;
  icon: ReactNode;
} {
  if (event.kind === "userMessage") {
    return { variant: "user", label: copy.language === "中" ? "你" : "You", icon: <MessageSquare size={14} /> };
  }
  if (["plan", "commandBegin", "commandEnd", "commandExecution", "approvalRequest", "approvalResult", "patchProposal", "question", "verification", "finalSummary", "contextCompaction"].includes(event.kind)) {
    return {
      variant: "tool",
      label: getToolEventLabel(copy, event),
      icon: getToolEventIcon(event),
    };
  }
  return {
    variant: "assistant",
    label: localizedAgentEventName(copy, event.title),
    icon: <MessageSquare size={14} />,
  };
}

function getToolEventIcon(event: ThreadEvent): ReactNode {
  if (event.kind === "plan") return <CheckCircle2 size={14} />;
  if (event.kind === "patchProposal") return <FileText size={14} />;
  if (["commandBegin", "commandEnd", "commandExecution", "approvalRequest", "approvalResult", "verification"].includes(event.kind)) return <TerminalSquare size={14} />;
  if (event.kind === "question") return <CircleAlert size={14} />;
  if (event.kind === "contextCompaction") return <CheckCircle2 size={14} />;
  return <Clock3 size={14} />;
}

function getToolEventLabel(copy: AppCopy, event: ThreadEvent): string {
  const text = `${event.title} ${event.message}`;
  const isZh = copy.language === "中";
  if (event.kind === "plan") return isZh ? "计划已就绪" : "Plan ready";
  if (event.kind === "patchProposal") return isZh ? "等待审查：补丁" : "Waiting for review: patch";
  if (event.kind === "approvalRequest") return isZh ? "等待审查：命令" : "Waiting for review: command";
  if (event.kind === "approvalResult") {
    if (/denied|拒绝/i.test(text)) return isZh ? "已拒绝" : "Denied";
    return isZh ? "已批准" : "Approved";
  }
  if (event.kind === "commandBegin") return isZh ? "正在运行命令" : "Running command";
  if (event.kind === "commandEnd") return isZh ? "命令结果" : "Command result";
  if (event.kind === "question") return isZh ? "等待回答" : "Waiting for answer";
  if (event.kind === "verification") {
    if (/denied|拒绝/i.test(text)) return isZh ? "验证已拒绝" : "Verification denied";
    if (/passed|通过|exit code 0|退出码 0/i.test(text)) return isZh ? "验证已通过" : "Verification passed";
    return isZh ? "等待审查：验证" : "Waiting for review: verification";
  }
  if (event.kind === "contextCompaction") return isZh ? "上下文已压缩" : "Context compacted";
  if (event.kind === "finalSummary") return isZh ? "最终总结" : "Final summary";
  if (/denied|拒绝/i.test(text)) return isZh ? "已拒绝" : "Denied";
  if (/granted|approved|批准|已批准/i.test(text)) return isZh ? "已批准" : "Approved";
  if (/continue|继续|Waiting For Continue|等待继续/i.test(text)) return isZh ? "等待继续" : "Waiting to continue";
  if (/run_command|command|命令|npm|cargo|pnpm|yarn/i.test(text)) return isZh ? "等待审查：命令" : "Waiting for review: command";
  return localizedAgentEventName(copy, event.title);
}

function summarizeToolEvent(copy: AppCopy, event: ThreadEvent): string {
  const message = compactRuntimeTextForTimeline(copy, event.message, 180);
  if (event.kind === "plan") {
    return copy.language === "中" ? "计划已导入；切换 Build 后开始执行。" : "Plan imported; switch to Build to execute.";
  }
  if (event.kind === "patchProposal" && event.patches?.length) {
    return copy.language === "中"
      ? `Agent 提出了补丁审查：${event.patches.length} ${copy.workbench.filesCount}`
      : `Agent proposed a patch review: ${event.patches.length} ${copy.workbench.filesCount}`;
  }
  const command = extractCommandHint(event.message);
  if (command) {
    const prefix = copy.language === "中" ? "命令" : "Command";
    return `${prefix}: ${command}`;
  }
  if (/等待继续|continue/i.test(`${event.title} ${event.message}`)) {
    return copy.language === "中"
      ? "上一步结果已记录，点击“继续执行”再交回模型。"
      : "The last result is recorded. Click Continue to return it to the model.";
  }
  return message;
}

function compactThreadEvents(events: ThreadEvent[]): ThreadEvent[] {
  const important = events.filter((event) => {
    if (event.patches?.length) return true;
    if (["userMessage", "plan", "commandBegin", "commandEnd", "commandExecution", "approvalRequest", "approvalResult", "patchProposal", "question", "verification", "finalSummary", "contextCompaction"].includes(event.kind)) return true;
    if (/final summary|最终总结|完成总结/i.test(`${event.title} ${event.message}`)) return true;
    if (/failed|error|denied|self-heal|run guard|guard|模型|model|api key|ollama|build 执行通道/i.test(`${event.title} ${event.message}`)) return true;
    return false;
  });

  const source = important.length > 0 ? important : events;
  const deduped: ThreadEvent[] = [];
  const seenRestore = new Set<string>();
  const seenSignatures = new Set<string>();
  const finalSummaryMessages = new Set(
    source
      .filter((event) => /final summary|最终总结|完成总结/i.test(`${event.title} ${event.message}`))
      .map((event) => normalizeEventMessage(event.message)),
  );

  for (const event of source) {
    const normalizedMessage = normalizeEventMessage(event.message);
    if (
      finalSummaryMessages.has(normalizedMessage) &&
      !/final summary|最终总结|完成总结/i.test(`${event.title} ${event.message}`)
    ) {
      continue;
    }

    if (event.title === "Recovered Waiting State") {
      const key = event.message;
      if (seenRestore.has(key)) continue;
      seenRestore.add(key);
    }

    const signature = `${event.kind}:${localizedEventSignatureTitle(event.title)}:${normalizedMessage}`;
    if (seenSignatures.has(signature)) continue;
    seenSignatures.add(signature);
    deduped.push(event);
  }

  return deduped.slice(-10);
}

function localizedEventSignatureTitle(title: string): string {
  return title.replace(/^Agent \([^)]+\)$/i, "Agent");
}

function normalizeEventMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim();
}

function extractCommandHint(message: string): string | null {
  const jsonMatch = message.match(/"command"\s*:\s*"([^"]+)"[\s\S]*?"args"\s*:\s*\[([^\]]*)\]/);
  if (jsonMatch) {
    const args = Array.from(jsonMatch[2].matchAll(/"([^"]+)"/g)).map((match) => match[1]);
    return [jsonMatch[1], ...args].join(" ");
  }
  const plain = message.match(/命令[:：]\s*([^\n。]+)/) || message.match(/Command[:：]\s*([^\n.]+)/i);
  if (plain) return plain[1].trim();
  const waiting = message.match(/批准命令[:：]\s*([^\n。]+)/) || message.match(/command approval.*?([a-z][^\n。]+)/i);
  if (waiting) return waiting[1].trim();
  return null;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (c) => map[c]);
}

function renderAgentMessage(copy: AppCopy, message: string): string {
  const localized = compactRuntimeTextForTimeline(copy, message);
  let safe = escapeHtml(localized);
  safe = safe.replace(/`([^`]+)`/g, "<code>$1</code>");
  safe = safe.replace(/\[([^\]]+)\]\(file:\/\/(?:\/|\.\/)([^)]+)\)/g, '<a href="file:///$2" class="file-link">$1</a>');
  safe = safe.replace(/\n/g, "<br />");
  return safe;
}
