import { AlertTriangle, Bot, Brain, CheckCircle2, CircleDot, ClipboardCheck, FileQuestion, Pause, Play, Square, UserRound } from "lucide-react";
import type { CodexInspectableItem, CodexThreadViewModel } from "../../domain/codex";
import type { AppCopy } from "../../i18n/copy";
import { EmptyState, StatusBadge } from "../../ui/primitives";
import { MarkdownText } from "./MarkdownText";

interface CodexThreadTimelineProps {
  copy: AppCopy;
  model: CodexThreadViewModel;
  showReasoningProcess: boolean;
  canStartBuild: boolean;
  canContinue: boolean;
  onStartBuild?: () => void | Promise<void>;
  onContinue?: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
  onAcceptPlanDraft?: (itemId: string) => void;
  onOpenReviewDock?: () => void;
}

function itemKindLabel(copy: AppCopy, item: CodexInspectableItem) {
  if (item.kind === "user") return copy.language === "中" ? "你" : "You";
  if (item.kind === "reasoning") return copy.language === "中" ? "推理" : "Reasoning";
  if (item.kind === "planDraft") return copy.language === "中" ? "Plan 草稿" : "Plan draft";
  if (item.kind === "error") return copy.language === "中" ? "错误" : "Error";
  return "Codex";
}

function statusText(copy: AppCopy, status: CodexInspectableItem["status"]) {
  if (status === "pending") return copy.language === "中" ? "等待中" : "Pending";
  if (status === "running") return copy.language === "中" ? "运行中" : "Running";
  if (status === "denied") return copy.language === "中" ? "已拒绝" : "Denied";
  if (status === "failed") return copy.language === "中" ? "失败" : "Failed";
  return copy.language === "中" ? "完成" : "Done";
}

function pendingActionLabel(copy: AppCopy, item: CodexInspectableItem) {
  if (item.kind === "approval") {
    return copy.language === "中" ? "批准命令" : "Approve command";
  }
  if (item.kind === "question") {
    return copy.workbench.agentQuestion;
  }
  return item.title;
}

function ItemIcon({ item }: { item: CodexInspectableItem }) {
  if (item.kind === "user") return <UserRound size={15} />;
  if (item.kind === "reasoning") return <Brain size={15} />;
  if (item.kind === "planDraft") return <ClipboardCheck size={15} />;
  if (item.kind === "error") return <AlertTriangle size={15} />;
  return <Bot size={15} />;
}

function CodexMessageItem({
  copy,
  item,
  reasoningOpen,
  onAcceptPlanDraft,
}: {
  copy: AppCopy;
  item: CodexInspectableItem;
  reasoningOpen: boolean;
  onAcceptPlanDraft?: (itemId: string) => void;
}) {
  const label = itemKindLabel(copy, item);
  const body = (
    <MarkdownText text={item.text} live={item.status === "running"} />
  );

  return (
    <article className={`codex-thread-item codex-thread-item-${item.kind} codex-thread-item-${item.tone} message-stream-item`}>
      <div className="codex-item-rail">
        <span className="codex-item-dot"><ItemIcon item={item} /></span>
        <span className="codex-item-line" />
      </div>
      <div className="codex-item-card">
        <header className="codex-item-header">
          <div>
            <strong>{label}</strong>
            <small>{item.title}</small>
          </div>
          <span>{item.timestamp}</span>
        </header>

        {item.kind === "reasoning" ? (
          <details className="reasoning-message" open={reasoningOpen}>
            <summary>
              <span>{reasoningOpen ? copy.settingsModal.thinkingExpanded : copy.settingsModal.thinkingCollapsed}</span>
              <small>{statusText(copy, item.status)}</small>
            </summary>
            {body}
          </details>
        ) : item.kind === "planDraft" ? (
          <div className="codex-plan-draft">
            {body}
            <button type="button" className="tool-row-action" onClick={() => onAcceptPlanDraft?.(item.id)}>
              {copy.language === "中" ? "采纳并进入 Build" : "Accept and enter Build"}
            </button>
          </div>
        ) : body}
      </div>
    </article>
  );
}

export function CodexThreadTimeline({
  copy,
  model,
  showReasoningProcess,
  canStartBuild,
  canContinue,
  onStartBuild,
  onContinue,
  onCancel,
  onAcceptPlanDraft,
  onOpenReviewDock,
}: CodexThreadTimelineProps) {
  const hasMessages = model.messages.length > 0;

  return (
    <section className="agent-collaboration-timeline codex-thread-log" aria-label="Codex thread timeline">
      <header className="codex-thread-toolbar">
        <div>
          <strong>{model.thread?.title || (copy.language === "中" ? "Codex 线程" : "Codex thread")}</strong>
          <small>
            {model.running
              ? (copy.language === "中" ? "Turn 运行中" : "Turn running")
              : model.interrupted
                ? (copy.language === "中" ? "Turn 已中断" : "Turn interrupted")
                : model.failed
                  ? (copy.language === "中" ? "Turn 失败" : "Turn failed")
                  : (copy.language === "中" ? "等待输入" : "Waiting for input")}
          </small>
        </div>
        <div className="codex-thread-actions">
          {model.running ? (
            <button type="button" onClick={() => void onCancel?.()} aria-label={copy.language === "中" ? "取消" : "Cancel"}>
              <Square size={14} />
              <span>{copy.language === "中" ? "取消" : "Cancel"}</span>
            </button>
          ) : canContinue ? (
            <button type="button" onClick={() => void onContinue?.()}>
              <Play size={14} />
              <span>{copy.workbench.continueQuestion}</span>
            </button>
          ) : canStartBuild ? (
            <button type="button" onClick={() => void onStartBuild?.()}>
              <Play size={14} />
              <span>{copy.thread.startLoop}</span>
            </button>
          ) : null}
        </div>
      </header>

      {model.pendingActions.length > 0 ? (
        <div className="timeline-pending-actions codex-action-summary" data-testid="timeline-pending-actions">
          {model.pendingActions.map((action) => (
            <button key={action.id} type="button" className="timeline-pending-action" onClick={onOpenReviewDock}>
              {action.kind === "question" ? <FileQuestion size={14} /> : <CircleDot size={14} />}
              <span>{pendingActionLabel(copy, action)}</span>
              <small>{action.title}</small>
              <StatusBadge tone="warning">{statusText(copy, action.status)}</StatusBadge>
            </button>
          ))}
        </div>
      ) : null}

      {model.error ? (
        <article className="codex-thread-item codex-thread-item-error codex-thread-item-danger">
          <div className="codex-item-rail">
            <span className="codex-item-dot"><AlertTriangle size={15} /></span>
          </div>
          <div className="codex-item-card">
            <header className="codex-item-header">
              <div>
                <strong>{copy.language === "中" ? "Codex 错误" : "Codex error"}</strong>
                <small>{model.error}</small>
              </div>
            </header>
          </div>
        </article>
      ) : null}

      {hasMessages ? (
        <div className="timeline-container">
          {model.messages.map((item, index) => {
            const hasAssistantAfter = item.kind === "reasoning" && model.messages
              .slice(index + 1)
              .some((next) => next.kind === "assistant" && (!item.turnId || !next.turnId || next.turnId === item.turnId));
            const reasoningOpen = showReasoningProcess && item.kind === "reasoning" && (item.status === "running" || !hasAssistantAfter);
            return (
              <CodexMessageItem
                key={item.id}
                copy={copy}
                item={item}
                reasoningOpen={reasoningOpen}
                onAcceptPlanDraft={onAcceptPlanDraft}
              />
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={model.running ? <Pause size={22} /> : <CheckCircle2 size={22} />}
          title={model.running ? copy.thread.thinking : copy.workbench.startEmptyTitle}
          body={copy.workbench.startEmptyBody}
        />
      )}
    </section>
  );
}
