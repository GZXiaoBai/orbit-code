import { Play, RefreshCw, XCircle } from "lucide-react";
import type { AgentLoopPhase, ToolCall } from "../../domain/agentLoop";
import type { AppCopy } from "../../i18n/copy";
import type { AgentEvent } from "../../state/useWorkspace";
import { AgentAvatar } from "../AgentAvatar";
import { localizedAgentEventName, localizedRuntimeText } from "./agentDisplayText";

interface AgentTimelineProps {
  copy: AppCopy;
  agentEvents: AgentEvent[];
  agentLoopPhase?: AgentLoopPhase;
  agentLoopRunning?: boolean;
  agentLoopToolCalls?: ToolCall[];
  onStartAgentLoop?: () => void;
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
  agentLoopToolCalls: _agentLoopToolCalls,
  onStartAgentLoop,
  onCancelAgentLoop,
  onRestartCollaboration,
  onApplyEventPatch: _onApplyEventPatch,
  onRefinePatch: _onRefinePatch,
  onUpdatePatch: _onUpdatePatch,
  streamingContent,
  streamingActive,
}: AgentTimelineProps) {
  if (agentEvents.length === 0) return null;
  const visibleEvents = compactAgentEvents(agentEvents);
  const hiddenCount = Math.max(0, agentEvents.length - visibleEvents.length);

  return (
    <section className="agent-collaboration-timeline">
      <div className="collaboration-header">
        <h3>{copy.thread.flowTitle}</h3>
        <div className="timeline-actions">
          {agentLoopRunning && (
            <span className="agent-loop-status">
              {copy.thread.agentLoopStatus}: {agentLoopPhase}
            </span>
          )}
          {onStartAgentLoop && !agentLoopRunning && (
            <button className="restart-flow-btn agent-loop-btn" onClick={onStartAgentLoop} title={copy.thread.startAgentLoopTitle}>
              <Play size={12} />
              <span className="sr-only">Agent Loop</span>
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

      <div className="timeline-container">
        {hiddenCount > 0 ? (
          <div className="timeline-history-note">
            {copy.language === "中" ? `已收起 ${hiddenCount} 条低优先级运行记录` : `${hiddenCount} low-priority run records hidden`}
          </div>
        ) : null}
        {visibleEvents.map((evt) => (
          <div key={evt.id} className={`timeline-node role-${evt.role} status-${evt.status}`}>
            <div className="node-avatar-col">
              <AgentAvatar role={evt.role} status={evt.status} size={24} />
              <div className="node-line-connector"></div>
            </div>
            <div className="node-content-col">
              <header className="node-meta">
                <strong>{localizedAgentEventName(copy, evt.name)}</strong>
                <span className="node-time">{evt.timestamp}</span>
              </header>
              <div className="node-message" dangerouslySetInnerHTML={{ __html: renderAgentMessage(copy, evt.message) }} />

              {evt.patches && evt.patches.length > 0 && (
                <div className="node-patch-summary">
                  <strong>{copy.workbench.patchReview}</strong>
                  <span>{evt.patches.length} {copy.workbench.filesCount} · {copy.workbench.changesTab}</span>
                </div>
              )}
            </div>
          </div>
        ))}
        {streamingActive && (
          <div className="timeline-node role-coder status-thinking">
            <div className="node-avatar-col">
              <AgentAvatar role="coder" status="thinking" size={24} />
              <div className="node-line-connector"></div>
            </div>
            <div className="node-content-col">
              <header className="node-meta">
                <strong>{copy.thread.thinking}</strong>
                <span className="node-time">{new Date().toLocaleTimeString()}</span>
              </header>
              <div className="node-message streaming-text">
                {streamingContent || "..."}
                <span className="cursor-blink">|</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function compactAgentEvents(events: AgentEvent[]): AgentEvent[] {
  const important = events.filter((event) => {
    if (event.patches?.length) return true;
    if (/failed|error|denied|approval|question|patch|plan ready|self-heal|verification|run guard|guard|模型|model|api key|ollama|build 执行通道/i.test(`${event.name} ${event.message}`)) return true;
    return false;
  });

  const source = important.length > 0 ? important : events;
  const deduped: AgentEvent[] = [];
  const seenRestore = new Set<string>();

  for (const event of source) {
    if (event.name === "Recovered Waiting State") {
      const key = event.message;
      if (seenRestore.has(key)) continue;
      seenRestore.add(key);
    }
    deduped.push(event);
  }

  return deduped.slice(-8);
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
  const localized = localizedRuntimeText(copy, message);
  let safe = escapeHtml(localized);
  safe = safe.replace(/\[([^\]]+)\]\(file:\/\/(?:\/|\.\/)([^)]+)\)/g, '<a href="file:///$2" class="file-link">$1</a>');
  return safe;
}
