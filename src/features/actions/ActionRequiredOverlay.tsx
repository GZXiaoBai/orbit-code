import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, CornerDownLeft, GitPullRequestArrow, Info, ShieldCheck, X } from "lucide-react";
import type { ActionGrantScope, ActionRequiredEvent } from "../../domain/actionRequired";
import type { QuestionAnswerInput } from "../../domain/questionRequest";
import { QUESTION_OPTION_DESCRIPTION_FALLBACK } from "../../domain/questionRequest";
import type { AgentEventPatch } from "../../domain/agentEvents";
import type { ThreadEvent } from "../../domain/threadEvents";
import type { PermissionAction } from "../../domain/types";
import type { AppCopy } from "../../i18n/copy";
import { DiffViewer } from "../../components/DiffViewer";
import { SelectMenu, StatusBadge } from "../../ui/primitives";
import { localizedAgentEventName } from "../../components/thread/agentDisplayText";
import { commandApprovalView, patchApplySummary, patchSandboxSummary } from "../review/reviewCardUtils";

interface ActionRequiredOverlayProps {
  copy: AppCopy;
  actions: ActionRequiredEvent[];
  events: ThreadEvent[];
  workspaceRoot: string;
  onResolve: (id: string, approved: boolean) => void;
  onCancel: (id: string) => void;
  onAnswer: (id: string, answer: string | QuestionAnswerInput) => void;
  onGrantScopeChange: (id: string, scope: ActionGrantScope) => void;
  onApplyPatch: (eventId: string) => Promise<void> | void;
  onUpdatePatch: (eventId: string, path: string, updates: Partial<AgentEventPatch>) => void;
}

function actionOrder(action: ActionRequiredEvent): number {
  if (action.kind === "question") return 0;
  if (action.kind === "command" || action.kind === "install" || action.kind === "network" || action.kind === "write" || action.kind === "verification") return 1;
  if (action.kind === "patchReview") return 2;
  return 3;
}

export function ActionRequiredOverlay({
  copy,
  actions,
  events,
  workspaceRoot,
  onResolve,
  onCancel,
  onAnswer,
  onGrantScopeChange,
  onApplyPatch,
  onUpdatePatch,
}: ActionRequiredOverlayProps) {
  const orderedActions = useMemo(
    () => actions
      .filter((action) => action.status === "pending")
      .sort((a, b) => actionOrder(a) - actionOrder(b) || a.createdAt.localeCompare(b.createdAt)),
    [actions],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());
  const visibleActions = orderedActions.filter((action) => !dismissedIds.has(action.id));
  const activeAction = visibleActions[Math.min(activeIndex, Math.max(0, visibleActions.length - 1))];

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, visibleActions.length - 1)));
  }, [visibleActions.length]);

  if (!activeAction) return null;

  const linkedEvent = activeAction.sourceEventId
    ? events.find((event) => event.id === activeAction.sourceEventId)
    : undefined;
  const nav = {
    index: Math.min(activeIndex, visibleActions.length - 1),
    total: visibleActions.length,
    previous: () => setActiveIndex((current) => Math.max(0, current - 1)),
    next: () => setActiveIndex((current) => Math.min(visibleActions.length - 1, current + 1)),
  };

  const overlayClass = [
    "approval-overlay",
    "action-required-overlay",
    activeAction.kind === "question" ? "structured-question-overlay" : "",
    activeAction.kind === "patchReview" ? "patch-review-overlay" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={overlayClass} role="presentation">
      {activeAction.kind === "question" ? (
        <QuestionActionDialog copy={copy} action={activeAction} nav={nav} onAnswer={onAnswer} onCancel={onCancel} />
      ) : activeAction.kind === "patchReview" && linkedEvent ? (
        <PatchActionDialog
          copy={copy}
          action={activeAction}
          event={linkedEvent}
          nav={nav}
          workspaceRoot={workspaceRoot}
          onApplyPatch={onApplyPatch}
          onUpdatePatch={onUpdatePatch}
          onDismiss={() => setDismissedIds((current) => new Set([...current, activeAction.id]))}
        />
      ) : (
        <ApprovalActionDialog
          copy={copy}
          action={activeAction}
          nav={nav}
          workspaceRoot={workspaceRoot}
          onResolve={onResolve}
          onGrantScopeChange={onGrantScopeChange}
        />
      )}
    </div>
  );
}

function ApprovalActionDialog({
  copy,
  action,
  nav,
  workspaceRoot,
  onResolve,
  onGrantScopeChange,
}: {
  copy: AppCopy;
  action: ActionRequiredEvent;
  nav: { index: number; total: number; previous: () => void; next: () => void };
  workspaceRoot: string;
  onResolve: (id: string, approved: boolean) => void;
  onGrantScopeChange: (id: string, scope: ActionGrantScope) => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const view = commandApprovalView((action.params || {}) as Record<string, unknown>, action.reason || action.description);
  const actionLabel = (permissionAction: PermissionAction) => copy.security[permissionAction] || permissionAction;
  const toolLabel = action.kind === "verification"
    ? copy.security.command
    : action.kind === "install"
      ? copy.security.install
      : action.kind === "network"
        ? copy.security.network
        : action.tool === "run_command"
          ? copy.security.command
          : action.title;
  const grantOptions: Array<{ value: ActionGrantScope; label: string; description?: string }> = [
    { value: "once", label: copy.workbench.grantOnce, description: copy.workbench.grantOnceDescription },
    { value: "session", label: copy.workbench.grantSession, description: copy.workbench.grantSessionDescription },
    { value: "project", label: copy.workbench.grantProject, description: copy.workbench.grantProjectDescription },
  ];
  const riskCopy = action.kind === "install"
    ? (copy.language === "中"
      ? "安装依赖会修改 lockfile 或本地依赖目录，并可能触发网络访问。拒绝后不会创建终端运行。"
      : "Installing dependencies can modify lockfiles or local dependency folders and may use network access. Denial will not create a terminal run.")
    : action.kind === "network"
      ? (copy.language === "中"
        ? "网络命令会访问远程地址，可能下载或上传数据。请确认来源可信。拒绝后不会创建终端运行。"
        : "Network commands can contact remote hosts and may download or upload data. Confirm the source is trusted. Denial will not create a terminal run.")
      : "";

  useEffect(() => {
    dialogRef.current?.focus();
  }, [action.id]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest(".ui-select-menu")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onResolve(action.id, false);
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onResolve(action.id, true);
    }
    if (event.key === "ArrowLeft" && nav.total > 1) {
      event.preventDefault();
      nav.previous();
    }
    if (event.key === "ArrowRight" && nav.total > 1) {
      event.preventDefault();
      nav.next();
    }
  };

  return (
    <div ref={dialogRef} className="approval-dialog" role="dialog" aria-modal="true" aria-labelledby="approval-dialog-title" tabIndex={-1} onKeyDown={onKeyDown}>
      <ActionHeader copy={copy} icon={<ShieldCheck size={16} />} kicker={copy.workbench.authorizationRequired} title={toolLabel} nav={nav} />
      <div className="approval-dialog-body">
        <div className="approval-command-summary approval-dialog-summary">
          <StatusBadge tone="warning">{copy.workbench.pendingApproval}</StatusBadge>
          <small>{view.reason}</small>
          <code className="approval-command-line">{view.display || action.description}</code>
          <small>{copy.workbench.workspacePath}: {view.workspacePath || workspaceRoot || copy.workbench.noWorkspace}</small>
          {riskCopy ? <small className="approval-risk-copy">{riskCopy}</small> : null}
          {view.cwd ? <small>CWD: {view.cwd}</small> : null}
          {view.args.length > 0 ? <small>{view.args.length} {copy.workbench.argsCount}</small> : null}
          <div className="approval-risk-list" aria-label={copy.workbench.permissionActions}>
            {view.actions.map((permissionAction) => (
              <span key={permissionAction} className="approval-risk-chip">{actionLabel(permissionAction)}</span>
            ))}
          </div>
          <div className="approval-grant-row">
            <span>{copy.workbench.grantScope}</span>
            <SelectMenu
              value={action.grantScope || "once"}
              ariaLabel={copy.workbench.grantScope}
              size="compact"
              options={grantOptions}
              onChange={(value) => onGrantScopeChange(action.id, value as ActionGrantScope)}
            />
          </div>
        </div>
      </div>
      <footer className="approval-dialog-footer">
        <button type="button" className="approval-dialog-deny" onClick={() => onResolve(action.id, false)}>
          <X size={16} />
          {copy.workbench.deny} <kbd>Esc</kbd>
        </button>
        <button type="button" className="approval-dialog-approve" onClick={() => onResolve(action.id, true)}>
          <Check size={16} />
          {copy.workbench.approve}
          <kbd>Enter</kbd>
        </button>
      </footer>
    </div>
  );
}

function QuestionActionDialog({
  copy,
  action,
  nav,
  onAnswer,
  onCancel,
}: {
  copy: AppCopy;
  action: ActionRequiredEvent;
  nav: { index: number; total: number; previous: () => void; next: () => void };
  onAnswer: (id: string, answer: string | QuestionAnswerInput) => void;
  onCancel: (id: string) => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const options = action.options || [];
  const freeformIndex = action.allowFreeform ? options.length : -1;
  const [selectedIndex, setSelectedIndex] = useState(() => Math.max(0, options.findIndex((option) => option.recommended)));
  const [draft, setDraft] = useState("");
  const [tooltipId, setTooltipId] = useState<string | null>(null);
  const hasChoices = options.length > 0;
  const choiceCount = options.length + (action.allowFreeform ? 1 : 0);
  const selectedOption = selectedIndex >= 0 && selectedIndex < options.length ? options[selectedIndex] : null;
  const freeformSelected = selectedIndex === freeformIndex;

  useEffect(() => {
    setSelectedIndex(Math.max(0, options.findIndex((option) => option.recommended)));
    setDraft("");
  }, [action.id, options]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, [action.id]);

  const commit = () => {
    if (selectedOption) {
      onAnswer(action.id, { selectedOptionId: selectedOption.id, answerType: "option" });
      return;
    }
    if (freeformSelected || !hasChoices) {
      const answer = draft.trim();
      if (answer) onAnswer(action.id, { answer, answerType: "freeform" });
    }
  };

  const moveSelection = (delta: number) => {
    if (choiceCount <= 0) return;
    setSelectedIndex((current) => (current + delta + choiceCount) % choiceCount);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const isTextEntry = target?.tagName === "TEXTAREA" || target?.tagName === "INPUT";
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel(action.id);
      return;
    }
    if (!isTextEntry && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      moveSelection(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (!isTextEntry && event.key === "ArrowLeft" && nav.total > 1) {
      event.preventDefault();
      nav.previous();
      return;
    }
    if (!isTextEntry && event.key === "ArrowRight" && nav.total > 1) {
      event.preventDefault();
      nav.next();
      return;
    }
    if (!isTextEntry && /^[1-9]$/.test(event.key)) {
      const next = Number(event.key) - 1;
      if (next < choiceCount) {
        event.preventDefault();
        setSelectedIndex(next);
      }
      return;
    }
    if (!isTextEntry && event.key === "Enter") {
      event.preventDefault();
      commit();
    }
  };

  const canContinue = Boolean(selectedOption || ((freeformSelected || !hasChoices) && draft.trim().length > 0));

  return (
    <div ref={dialogRef} className="structured-question-dialog" role="dialog" aria-modal="true" aria-labelledby="structured-question-title" tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="structured-question-header">
        <h2 id="structured-question-title">{action.question || action.description}</h2>
        <Pager copy={copy} nav={nav} />
      </header>
      <div className="structured-question-options" role={hasChoices ? "radiogroup" : undefined}>
        {options.map((option, optionIndex) => {
          const selected = optionIndex === selectedIndex;
          const description = option.description || QUESTION_OPTION_DESCRIPTION_FALLBACK;
          const infoId = `action-question-info-${action.id}-${option.id}`;
          return (
            <button key={option.id} type="button" className={`structured-question-option ${selected ? "selected" : ""}`} role="radio" aria-checked={selected} aria-describedby={tooltipId === infoId ? infoId : undefined} onClick={() => setSelectedIndex(optionIndex)} onDoubleClick={() => onAnswer(action.id, { selectedOptionId: option.id, answerType: "option" })}>
              <span className="structured-question-number">{optionIndex + 1}.</span>
              <span className="structured-question-label">{option.label}{option.recommended ? ` (${copy.workbench.recommended})` : ""}</span>
              <span className="structured-question-info" tabIndex={0} role="button" aria-label={description} onFocus={() => setTooltipId(infoId)} onBlur={() => setTooltipId((current) => current === infoId ? null : current)} onMouseEnter={() => setTooltipId(infoId)} onMouseLeave={() => setTooltipId((current) => current === infoId ? null : current)} onClick={(event) => { event.stopPropagation(); setTooltipId((current) => current === infoId ? null : infoId); }}>
                <Info size={14} />
                {tooltipId === infoId ? <span id={infoId} className="structured-question-tooltip" role="tooltip">{description}</span> : null}
              </span>
              {selected ? <span className="structured-question-arrows" aria-hidden="true"><ArrowUp size={15} /><ArrowDown size={15} /></span> : null}
            </button>
          );
        })}
        {action.allowFreeform ? (
          <button type="button" className={`structured-question-option structured-question-freeform ${freeformSelected ? "selected" : ""}`} role={hasChoices ? "radio" : undefined} aria-checked={hasChoices ? freeformSelected : undefined} onClick={() => setSelectedIndex(freeformIndex)}>
            <span className="structured-question-number">{options.length + 1}.</span>
            <span className="structured-question-label">{copy.workbench.freeformQuestionOption}</span>
          </button>
        ) : null}
        {(!hasChoices || freeformSelected) ? (
          <textarea className="structured-question-textarea" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={copy.workbench.answerPlaceholder} autoFocus={!hasChoices} />
        ) : null}
      </div>
      <footer className="structured-question-footer">
        <button type="button" className="structured-question-ignore" onClick={() => onCancel(action.id)}>
          {copy.workbench.ignoreQuestion} <kbd>Esc</kbd>
        </button>
        <button type="button" className="structured-question-continue" onClick={commit} disabled={!canContinue}>
          {copy.workbench.continueQuestion}
          <span><CornerDownLeft size={14} /></span>
        </button>
      </footer>
    </div>
  );
}

function PatchActionDialog({
  copy,
  action,
  event,
  nav,
  workspaceRoot,
  onApplyPatch,
  onUpdatePatch,
  onDismiss,
}: {
  copy: AppCopy;
  action: ActionRequiredEvent;
  event: ThreadEvent;
  nav: { index: number; total: number; previous: () => void; next: () => void };
  workspaceRoot: string;
  onApplyPatch: (eventId: string) => Promise<void> | void;
  onUpdatePatch: (eventId: string, path: string, updates: Partial<AgentEventPatch>) => void;
  onDismiss: () => void;
}) {
  const sandboxStatus = patchSandboxSummary(event);
  const applyStatus = patchApplySummary(event);
  const patches = event.patches || [];
  const canApply = patches.length > 0
    && patches.some((patch) => !patch.applied)
    && patches.every((patch) => patch.applied || (patch.sandboxStatus === "sandboxed" && patch.applyStatus !== "failed" && !patch.hasConflict));
  return (
    <section className="approval-dialog patch-review-dialog" role="dialog" aria-modal="true" aria-labelledby="patch-review-dialog-title" tabIndex={-1}>
      <ActionHeader copy={copy} icon={<GitPullRequestArrow size={16} />} kicker={copy.language === "中" ? "需要审查" : "Review required"} title={localizedAgentEventName(copy, event.title || action.title)} nav={nav} titleId="patch-review-dialog-title" />
      <div className="patch-review-overlay-meta">
        <StatusBadge tone={sandboxStatus === "failed" ? "danger" : sandboxStatus === "sandboxed" ? "success" : "warning"}>
          {copy.workbench.sandboxLabel} {copy.workbench.patchSandboxStatus[sandboxStatus]}
        </StatusBadge>
        <StatusBadge tone={applyStatus === "failed" ? "danger" : applyStatus === "applied" ? "success" : "warning"}>
          {copy.workbench.applyLabel} {copy.workbench.patchApplyStatus[applyStatus]}
        </StatusBadge>
        <span>{patches.length} {copy.language === "中" ? "个文件" : "files"}</span>
      </div>
      <div className="patch-review-overlay-body">
        <DiffViewer copy={copy} patches={patches} onApply={() => Promise.resolve(onApplyPatch(event.id))} workspacePath={workspaceRoot} eventId={event.id} onUpdatePatch={onUpdatePatch} />
      </div>
      <footer className="approval-dialog-footer">
        <button type="button" className="approval-dialog-deny" onClick={onDismiss}>
          <X size={16} />
          <span>{copy.language === "中" ? "稍后" : "Later"}</span>
        </button>
        <button type="button" className="approval-dialog-approve" onClick={() => void onApplyPatch(event.id)} disabled={!canApply}>
          <Check size={16} />
          <span>{copy.diff.applyAll}</span>
        </button>
      </footer>
    </section>
  );
}

function ActionHeader({
  copy,
  icon,
  kicker,
  title,
  nav,
  titleId = "approval-dialog-title",
}: {
  copy: AppCopy;
  icon: ReactNode;
  kicker: string;
  title: string;
  nav: { index: number; total: number; previous: () => void; next: () => void };
  titleId?: string;
}) {
  return (
    <header className="approval-dialog-header">
      <div>
        <span className="approval-dialog-kicker">{icon}{kicker}</span>
        <h2 id={titleId}>{title}</h2>
      </div>
      <Pager copy={copy} nav={nav} />
    </header>
  );
}

function Pager({
  copy,
  nav,
}: {
  copy: AppCopy;
  nav: { index: number; total: number; previous: () => void; next: () => void };
}) {
  return (
    <div className="approval-dialog-pager" aria-label={copy.workbench.approvalPager}>
      <button type="button" onClick={nav.previous} disabled={nav.index === 0} aria-label={copy.workbench.previousApproval}>
        <ArrowLeft size={16} />
      </button>
      <span>{nav.index + 1} of {nav.total}</span>
      <button type="button" onClick={nav.next} disabled={nav.index >= nav.total - 1} aria-label={copy.workbench.nextApproval}>
        <ArrowRight size={16} />
      </button>
    </div>
  );
}
