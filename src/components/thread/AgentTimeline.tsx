import { CheckCircle2, CircleAlert, Clock3, FileText, MessageSquare, Play, RefreshCw, TerminalSquare, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { AgentLoopPhase, ToolCall } from "../../domain/agentLoop";
import type { PendingAction } from "../../domain/threadEventSelectors";
import type { ThreadEvent } from "../../domain/threadEvents";
import type { RuntimeThreadViewModel } from "../../domain/runtimeThreadSelectors";
import type { AppCopy } from "../../i18n/copy";
import { compactRuntimeTextForTimeline, localizedAgentEventName } from "./agentDisplayText";
import { RichFileText } from "./RichFileText";

interface AgentTimelineProps {
  copy: AppCopy;
  threadEvents: ThreadEvent[];
  runtimeThread?: RuntimeThreadViewModel;
  agentLoopPhase?: AgentLoopPhase;
  agentLoopRunning?: boolean;
  agentLoopToolCalls?: ToolCall[];
  pendingActions?: PendingAction[];
  onStartAgentLoop?: () => void;
  onContinueAgentRun?: () => void;
  canContinueAgentRun?: boolean;
  onCancelAgentLoop?: () => void;
  onRestartCollaboration?: () => void;
  onApplyEventPatch?: (eventId: string) => Promise<void>;
  onRefinePatch?: (eventId: string, feedback: string) => Promise<void> | void;
  onUpdatePatch?: (eventId: string, path: string, updates: Partial<any>) => void;
  onAcceptPlanDraft?: (eventId: string) => void;
  streamingContent?: string;
  streamingActive?: boolean;
  showReasoningProcess?: boolean;
}

export function AgentTimeline({
  copy,
  threadEvents,
  runtimeThread,
  agentLoopPhase,
  agentLoopRunning,
  agentLoopToolCalls = [],
  pendingActions = [],
  onStartAgentLoop,
  onContinueAgentRun,
  canContinueAgentRun,
  onCancelAgentLoop,
  onRestartCollaboration,
  onApplyEventPatch: _onApplyEventPatch,
  onRefinePatch: _onRefinePatch,
  onUpdatePatch: _onUpdatePatch,
  onAcceptPlanDraft,
  streamingContent,
  streamingActive,
  showReasoningProcess = true,
}: AgentTimelineProps) {
  const hasActions = Boolean(
    onStartAgentLoop ||
    onContinueAgentRun ||
    onCancelAgentLoop ||
    onRestartCollaboration ||
    agentLoopRunning ||
    streamingActive,
  );
  const hasRuntimeMessages = Boolean(runtimeThread?.messages.length);
  if (threadEvents.length === 0 && !hasActions && !hasRuntimeMessages) return null;
  const visibleEvents = compactThreadEvents(
    hasRuntimeMessages
      ? threadEvents.filter((event) => !["userMessage", "agentMessage", "reasoningSummary", "toolCall"].includes(event.kind))
      : threadEvents,
    showReasoningProcess,
  );
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
        {hasRuntimeMessages ? <RuntimeThreadMessages copy={copy} runtimeThread={runtimeThread!} /> : null}
        {visibleEvents.map((evt) => {
          const display = getThreadEventDisplay(copy, evt);
          return (
            <div
              key={evt.id}
              className={`timeline-node message-stream-item message-${display.variant} role-${evt.role} status-${evt.status} thread-event-${evt.kind}`}
            >
              {display.variant === "tool" ? (
                <ToolEventRow copy={copy} event={evt} icon={display.icon} label={display.label} onAcceptPlanDraft={onAcceptPlanDraft} />
              ) : (
                <MessageBubble copy={copy} event={evt} label={display.label} isUser={display.variant === "user"} />
              )}
            </div>
          );
        })}
        <PendingActionStrip
          copy={copy}
          actions={pendingActions}
        />
        {showReasoningProcess && streamingActive && (
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

function RuntimeThreadMessages({ copy, runtimeThread }: { copy: AppCopy; runtimeThread: RuntimeThreadViewModel }) {
  return (
    <>
      {runtimeThread.messages.map((message) => (
        <div
          key={message.id}
          className={`timeline-node message-stream-item message-${message.role === "user" ? "user" : "assistant"} role-${message.role} status-${message.status === "streaming" ? "thinking" : "done"}`}
        >
          <article className={message.role === "user" ? "user-message" : "assistant-message"}>
            <div className="message-author">{message.role === "user" ? (copy.language === "中" ? "你" : "You") : "Agent"}</div>
            {message.parts.map((part, index) => {
              if (part.type === "thinking" || part.type === "reasoning") {
                const text = part.text;
                if (!text) return null;
                return (
                  <details key={`${message.id}-thinking-${index}`} className="reasoning-message" open={part.type === "thinking" ? !part.collapsed : false}>
                    <summary>
                      <span>{copy.thread.thinking}</span>
                      <small>{part.type === "thinking" && !part.collapsed ? (copy.language === "中" ? "进行中" : "running") : (copy.language === "中" ? "已折叠" : "collapsed")}</small>
                    </summary>
                    <div className="node-message">
                      <RichFileText copy={copy} text={compactRuntimeTextForTimeline(copy, text, 1200)} surface="timeline" />
                    </div>
                  </details>
                );
              }
              if (part.type === "text") {
                return <div key={`${message.id}-text-${index}`} className="node-message"><RichFileText copy={copy} text={part.text} surface="timeline" /></div>;
              }
              if (part.type === "toolCall") {
                return (
                  <div key={`${message.id}-tool-${part.id}-${index}`} className="tool-event-row">
                    <TerminalSquare size={14} />
                    <strong>{String(part.name)}</strong>
                    <span>{part.argsSummary}</span>
                  </div>
                );
              }
              if (part.type === "toolResult") {
                return <div key={`${message.id}-result-${index}`} className="node-message tool-result-message">{compactRuntimeTextForTimeline(copy, part.content, 360)}</div>;
              }
              if (part.type === "error") {
                return <div key={`${message.id}-error-${index}`} className="node-message timeline-error">{part.message}</div>;
              }
              return null;
            })}
          </article>
        </div>
      ))}
    </>
  );
}

function PendingActionStrip({
  copy,
  actions,
}: {
  copy: AppCopy;
  actions: PendingAction[];
}) {
  const grouped = actions.reduce<Record<string, number>>((acc, action) => {
    acc[action.kind] = (acc[action.kind] || 0) + 1;
    return acc;
  }, {});
  const labelFor = (kind: string, count: number) => {
    if (kind === "question") return copy.language === "中" ? `回答问题 ${count}` : `Answer question ${count}`;
    if (kind === "patch") return copy.language === "中" ? `审查补丁 ${count}` : `Review patch ${count}`;
    if (kind === "verification") return copy.language === "中" ? `批准验证 ${count}` : `Approve verification ${count}`;
    if (kind === "rollback") return copy.language === "中" ? `处理回滚 ${count}` : `Handle rollback ${count}`;
    return copy.language === "中" ? `批准命令 ${count}` : `Approve command ${count}`;
  };
  const items = Object.entries(grouped).map(([kind, count]) => ({
    key: kind,
    label: labelFor(kind, count),
    onClick: () => focusElement(".action-required-overlay [role='dialog']"),
  }));

  if (items.length === 0) return null;

  return (
    <div className="timeline-pending-actions" data-testid="timeline-pending-actions">
      {items.map((item) => (
        <button key={item.key} type="button" className="timeline-pending-action" onClick={item.onClick}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

function focusElement(selector: string) {
  const target = document.querySelector<HTMLElement>(selector);
  target?.focus();
  target?.scrollIntoView({ block: "center", behavior: "smooth" });
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
    propose_patch: "提出补丁",
    ask_user: "询问用户",
    done: "完成",
    done_plan: "完成计划",
    done_build: "完成执行",
  };
  const en: Record<ToolCall["name"], string> = {
    read_file: "Read file",
    search_code: "Search code",
    list_files: "List files",
    run_command: "Run command",
    apply_patch: "Propose patch",
    propose_patch: "Propose patch",
    ask_user: "Ask user",
    done: "Done",
    done_plan: "Done planning",
    done_build: "Done building",
  };
  return copy.language === "中" ? zh[name] : en[name];
}

function summarizeLiveToolCall(copy: AppCopy, call: ToolCall, exploredFileCount: number): string {
  if (exploredFileCount > 0 && ["read_file", "search_code", "list_files"].includes(call.name)) {
    return copy.workbench.agentOperationFiles.replace("{count}", String(exploredFileCount));
  }
  if (call.name === "apply_patch" || call.name === "propose_patch") {
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
  } else if (call.name === "apply_patch" || call.name === "propose_patch") {
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
  if (event.kind === "reasoningSummary") {
    return (
      <article className="assistant-message reasoning-message">
        <details open={event.status === "thinking"}>
          <summary>
            <span>{label}</span>
            <small>{event.status === "thinking" ? (copy.language === "中" ? "进行中" : "running") : (copy.language === "中" ? "已折叠" : "collapsed")}</small>
          </summary>
          <div className="node-message">
            <RichFileText
              copy={copy}
              text={compactRuntimeTextForTimeline(copy, event.message)}
              workspacePath={event.workspacePath}
              surface="timeline"
            />
          </div>
        </details>
        <footer className="message-meta">
          <span>{event.timestamp}</span>
        </footer>
      </article>
    );
  }

  return (
    <article className={isUser ? "user-message" : "assistant-message"}>
      {!isUser ? <div className="message-author">{label}</div> : null}
      <div className="node-message">
        <RichFileText
          copy={copy}
          text={compactRuntimeTextForTimeline(copy, event.message)}
          workspacePath={event.workspacePath}
          surface="timeline"
        />
      </div>
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
  onAcceptPlanDraft,
}: {
  copy: AppCopy;
  event: ThreadEvent;
  icon: ReactNode;
  label: string;
  onAcceptPlanDraft?: (eventId: string) => void;
}) {
  return (
    <div className="message-tool-row">
      <span className="tool-row-line" aria-hidden="true" />
      <span className="tool-row-body">
        <span className="tool-row-icon">{icon}</span>
        <span className="tool-row-copy">
          <strong>{label}</strong>
          <span>
            <RichFileText
              copy={copy}
              text={summarizeToolEvent(copy, event)}
              workspacePath={event.workspacePath}
              surface="timeline"
            />
          </span>
        </span>
        {event.patches && event.patches.length > 0 ? (
          <span className="tool-row-pill">
            {event.patches.length} {copy.workbench.filesCount}
          </span>
        ) : null}
        {event.kind === "planDraft" && event.planDraft && onAcceptPlanDraft ? (
          <button type="button" className="tool-row-action" onClick={() => onAcceptPlanDraft(event.id)}>
            {copy.language === "中" ? "采纳并进入 Build" : "Accept and enter Build"}
          </button>
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
  if (event.kind === "reasoningSummary") {
    return { variant: "assistant", label: getToolEventLabel(copy, event), icon: <Clock3 size={14} /> };
  }
  if (["plan", "planDraft", "toolCall", "approval", "terminalRun", "error", "commandBegin", "commandEnd", "commandExecution", "approvalRequest", "approvalResult", "patchProposal", "question", "verification", "finalSummary", "contextCompaction", "modeSwitch", "toolDeniedByMode"].includes(event.kind)) {
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
  if (event.kind === "planDraft") return <FileText size={14} />;
  if (event.kind === "patchProposal") return <FileText size={14} />;
  if (["commandBegin", "commandEnd", "commandExecution", "toolCall", "terminalRun", "approval", "approvalRequest", "approvalResult", "verification"].includes(event.kind)) return <TerminalSquare size={14} />;
  if (event.kind === "question") return <CircleAlert size={14} />;
  if (event.kind === "contextCompaction") return <CheckCircle2 size={14} />;
  if (event.kind === "modeSwitch") return <Play size={14} />;
  if (event.kind === "toolDeniedByMode") return <CircleAlert size={14} />;
  return <Clock3 size={14} />;
}

function getToolEventLabel(copy: AppCopy, event: ThreadEvent): string {
  const text = `${event.title} ${event.message}`;
  const isZh = copy.language === "中";
  if (event.kind === "plan") return isZh ? "计划已就绪" : "Plan ready";
  if (event.kind === "planDraft") return isZh ? "计划草案" : "Plan draft";
  if (event.kind === "patchProposal") return isZh ? "等待审查：补丁" : "Waiting for review: patch";
  if (event.kind === "approval") return isZh ? "等待授权" : "Waiting for approval";
  if (event.kind === "toolCall") return isZh ? "工具调用" : "Tool call";
  if (event.kind === "terminalRun") return isZh ? "终端运行" : "Terminal run";
  if (event.kind === "error") return isZh ? "错误" : "Error";
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
  if (event.kind === "modeSwitch") return isZh ? "模式切换" : "Mode switched";
  if (event.kind === "toolDeniedByMode") return isZh ? "模式已拒绝工具" : "Tool denied by mode";
  if (event.kind === "reasoningSummary") return event.status === "thinking"
    ? (isZh ? "Agent 正在思考" : "Agent reasoning")
    : (isZh ? "思考过程" : "Reasoning");
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
  if (event.kind === "planDraft" && event.planDraft) {
    return copy.language === "中"
      ? `只读 Planner 生成了草案：${event.planDraft.tasks.length} 个任务。采纳后才会进入 Build。`
      : `Read-only Planner generated a draft: ${event.planDraft.tasks.length} tasks. Accept it to enter Build.`;
  }
  if (event.kind === "patchProposal" && event.patches?.length) {
    return copy.language === "中"
      ? `Agent 提出了补丁审查：${event.patches.length} ${copy.workbench.filesCount}`
      : `Agent proposed a patch review: ${event.patches.length} ${copy.workbench.filesCount}`;
  }
  if (event.kind === "question" && event.question) {
    if (event.question.status === "answered" && event.question.answer) {
      return copy.language === "中"
        ? `已回答：${event.question.answer}`
        : `Answered: ${event.question.answer}`;
    }
    if (event.question.status === "cancelled") {
      return copy.language === "中" ? "问题已忽略，Agent 将重新规划。" : "Question ignored; the Agent will re-plan.";
    }
    const optionCount = event.question.options?.length || 0;
    return optionCount > 0
      ? `${event.question.question} (${optionCount} ${copy.workbench.optionsCount})`
      : event.question.question;
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

function compactThreadEvents(events: ThreadEvent[], showReasoningProcess: boolean): ThreadEvent[] {
  const important = events.filter((event) => {
    if (event.kind === "reasoningSummary") return showReasoningProcess;
    if (event.patches?.length) return true;
    if (["userMessage", "plan", "planDraft", "toolCall", "approval", "terminalRun", "error", "commandBegin", "commandEnd", "commandExecution", "approvalRequest", "approvalResult", "patchProposal", "question", "verification", "finalSummary", "contextCompaction", "modeSwitch", "toolDeniedByMode"].includes(event.kind)) return true;
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
