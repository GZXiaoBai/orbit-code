import { useEffect, useMemo, useRef, useState } from "react";
import { Check, FileCode2, GitPullRequestArrow, ListChecks, ShieldCheck, X } from "lucide-react";
import type { PlanTask, TaskStatus } from "../../domain/types";
import type { Theme } from "../../domain/types";
import type { TerminalRun } from "../../domain/terminalRun";
import type { AppCopy } from "../../i18n/copy";
import type { useWorkspace } from "../../state/useWorkspace";
import { useFilePreview } from "../../state/useFilePreview";
import { Button, EmptyState, SelectMenu, StatusBadge, Tabs } from "../../ui/primitives";
import { CodePreview } from "./CodePreview";
import { CommandApprovalQueue } from "./CommandApprovalQueue";
import { PatchReviewQueue } from "./PatchReviewQueue";
import { QuestionQueue } from "./QuestionQueue";
import { TerminalRunList } from "./TerminalRunList";
import { VerificationQueue } from "./VerificationQueue";
import { statusTone } from "./reviewCardUtils";
import { localizedAgentEventName, localizedRuntimeText } from "../../components/thread/agentDisplayText";

type WorkspaceState = ReturnType<typeof useWorkspace>;
type DockTab = "files" | "tasks" | "changes" | "terminal";

interface ReviewDockProps {
  copy: AppCopy;
  theme: Theme;
  workspace: WorkspaceState;
}

export function ReviewDock({ copy, theme, workspace }: ReviewDockProps) {
  const [activeTab, setActiveTab] = useState<DockTab>("files");
  const didAutoSelectTab = useRef(false);
  const model = workspace.reviewDockModel;
  const filePreview = useFilePreview(workspace.activeFilePath, workspace.activeFileContent);
  const tasks = workspace.importedPlan?.plan.tasks ?? [];
  const terminalRuns = model.terminalRuns.length > 0
    ? model.terminalRuns
    : model.historyTerminalRuns;
  const taskStatusOptions: Array<{ value: TaskStatus; label: string }> = [
    { value: "queued", label: copy.workbench.taskStatus.queued },
    { value: "running", label: copy.workbench.taskStatus.running },
    { value: "blocked", label: copy.workbench.taskStatus.blocked },
    { value: "review", label: copy.workbench.taskStatus.review },
    { value: "verified", label: copy.workbench.taskStatus.verified },
    { value: "done", label: copy.workbench.taskStatus.done },
  ];
  const terminalEntries: TerminalRun[] = terminalRuns.length > 0 ? terminalRuns : Object.entries(workspace.terminalLogs).map(([taskId, output]) => ({
    id: taskId,
    taskId,
    command: taskId,
    args: [],
    reason: taskId,
    status: workspace.commandStatus[taskId]?.running ? "running" : "done",
    exitCode: workspace.commandStatus[taskId]?.exitCode ?? null,
    output,
    startedAt: "",
    completedAt: undefined,
  }));
  const failedTerminalCount = terminalEntries.filter((run) => run.status === "failed" || (run.exitCode !== null && run.exitCode !== 0)).length;
  const activeChangeSteps = useMemo(
    () => workspace.runSteps
      .filter((step) => (step.kind === "command" || step.kind === "patch") && step.status !== "done")
      .slice(-4),
    [workspace.runSteps],
  );
  const headerStatus = reviewHeaderStatus(copy, model.counts.changes, failedTerminalCount, workspace.pendingApprovals.length);

  useEffect(() => {
    if (didAutoSelectTab.current) return;
    if (model.counts.changes > 0) {
      didAutoSelectTab.current = true;
      setActiveTab("changes");
    } else if (failedTerminalCount > 0) {
      didAutoSelectTab.current = true;
      setActiveTab("terminal");
    }
  }, [failedTerminalCount, model.counts.changes]);

  useEffect(() => {
    const focusReviewDock = () => {
      setActiveTab("changes");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const dock = document.querySelector(".review-dock");
          const target = dock?.querySelector<HTMLElement>("[data-review-focus='pending'], .approval-request-card, .dock-diff-card, .dock-run-step");
          target?.scrollIntoView({ block: "center", behavior: "smooth" });
          target?.classList.add("review-focus-pulse");
          window.setTimeout(() => target?.classList.remove("review-focus-pulse"), 1200);
        });
      });
    };
    window.addEventListener("orbit:focus-review-dock", focusReviewDock);
    return () => window.removeEventListener("orbit:focus-review-dock", focusReviewDock);
  }, []);

  return (
    <aside className="review-dock" aria-label={copy.workbench.reviewDock}>
      <header className="review-dock-header">
        <strong>{copy.workbench.reviewDock}</strong>
        <StatusBadge tone={headerStatus.tone}>
          {headerStatus.label}
        </StatusBadge>
      </header>

      <Tabs
        active={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: "files", label: copy.workbench.filesTab },
          { id: "tasks", label: copy.workbench.tasksTab, count: tasks.length },
          { id: "changes", label: copy.workbench.changesTab, count: model.counts.changes },
          { id: "terminal", label: copy.workbench.terminalTab, count: terminalEntries.length },
        ]}
      />

      <div className="review-dock-body">
        {activeTab === "files" ? (
          workspace.activeFilePath && workspace.activeFileContent !== null ? (
            <CodePreview copy={copy} preview={filePreview} theme={theme} onClose={() => workspace.viewFile("")} />
          ) : (
            <EmptyState icon={<FileCode2 size={22} />} title={copy.workbench.noFileSelected} />
          )
        ) : null}

        {activeTab === "tasks" ? (
          tasks.length > 0 ? (
            <div className="dock-task-list">
              {tasks.map((task: PlanTask) => (
                <article key={task.id} className="dock-task">
                  <header>
                    <div className="dock-task-title-block">
                      <strong>{task.title}</strong>
                      <small>{task.id}</small>
                    </div>
                    <SelectMenu
                      value={task.status}
                      ariaLabel={`${task.title} ${copy.workbench.status}`}
                      size="compact"
                      onChange={(value) => workspace.updateTask(task.id, { status: value as TaskStatus })}
                      options={taskStatusOptions}
                    />
                  </header>
                  <p>{task.description}</p>
                  <StatusBadge tone={statusTone(task.status)}>{copy.workbench.taskStatus[task.status]}</StatusBadge>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState icon={<ListChecks size={22} />} title={copy.noPlan} />
          )
        ) : null}

        {activeTab === "changes" ? (
          <div className="dock-changes">
            {activeChangeSteps.map((step) => (
              <article key={step.id} className={`dock-run-step dock-run-step-${step.status}`} data-review-focus="pending">
                <header>
                  <div>
                    <strong>{localizedAgentEventName(copy, step.title)}</strong>
                    <small>{localizedRuntimeText(copy, step.detail)}</small>
                  </div>
                  <StatusBadge tone={step.status === "waiting" ? "warning" : step.status === "denied" || step.status === "failed" ? "danger" : step.status === "done" ? "success" : "neutral"}>
                    {copy.workbench.runStepStatus[step.status]}
                  </StatusBadge>
                </header>
              </article>
            ))}

            <CommandApprovalQueue
              copy={copy}
              approvals={model.commandApprovals}
              workspaceRoot={workspace.workspaceRoot}
              onResolve={workspace.resolveApproval}
              onGrantScopeChange={workspace.updateApprovalGrantScope}
            />

            <QuestionQueue
              copy={copy}
              questions={model.questions}
              onAnswer={workspace.answerQuestion}
              onCancel={workspace.cancelQuestion}
            />

            <PatchReviewQueue
              copy={copy}
              events={model.patchReviews}
              onApply={workspace.applyEventPatch}
              onUpdatePatch={workspace.updateEventPatch}
            />

            {(model.appliedPatchReviews.length > 0 || model.failedPatchReviews.length > 0 || model.historyPatchReviews.length > 0) ? (
              <div className="dock-applied-history">
                <div className="dock-queue-heading">
                  <GitPullRequestArrow size={14} />
                  <strong>{copy.workbench.patchHistory}</strong>
                </div>
                {[...model.appliedPatchReviews, ...model.failedPatchReviews, ...model.historyPatchReviews].slice(0, 4).map((event) => {
                  const failed = event.patches?.every((patch) => !patch.applied && (patch.sandboxStatus === "failed" || patch.applyStatus === "failed"));
                  return (
                    <article key={event.id} className="dock-run-step dock-run-step-done">
                    <header>
                      <div>
                        <strong>{localizedAgentEventName(copy, event.name)}</strong>
                        <small>{event.patches?.map((patch) => patch.path).join(", ")}</small>
                      </div>
                      <StatusBadge tone={failed ? "danger" : "success"}>
                        {failed ? copy.workbench.patchFailed : copy.diff.allApplied}
                      </StatusBadge>
                    </header>
                  </article>
                  );
                })}
              </div>
            ) : null}

            <VerificationQueue
              copy={copy}
              approvals={model.verificationApprovals}
              workspaceRoot={workspace.workspaceRoot}
              onResolve={workspace.resolveApproval}
              onGrantScopeChange={workspace.updateApprovalGrantScope}
            />

            {model.otherApprovals.length > 0 ? (
              <div className="dock-queue-heading">
                <ShieldCheck size={14} />
                <strong>{copy.workbench.questionsAndGates}</strong>
              </div>
            ) : null}

            {model.otherApprovals.map((request) => (
                <article key={request.id} className="approval-request-card" data-review-focus="pending">
                <header>
                  <div>
                    <strong>{localizedAgentEventName(copy, request.tool)}</strong>
                    <small>{request.reason || copy.workbench.pendingApproval}</small>
                  </div>
                  <StatusBadge tone="warning">{copy.workbench.pendingApproval}</StatusBadge>
                </header>
                <div className="approval-param-list">
                  {approvalParamEntries(request.params as Record<string, unknown>).map(([key, value]) => (
                    <span key={key}>
                      <strong>{localizedApprovalParamKey(copy, key)}</strong>
                      <code>{formatApprovalParamValue(value)}</code>
                    </span>
                  ))}
                </div>
                <footer>
                  <Button variant="ghost" onClick={() => workspace.resolveApproval(request.id, false)}>
                    <X size={14} />
                    {copy.workbench.deny}
                  </Button>
                  <Button variant="primary" onClick={() => workspace.resolveApproval(request.id, true)}>
                    <Check size={14} />
                    {copy.workbench.approve}
                  </Button>
                </footer>
              </article>
            ))}

            {model.counts.changes === 0 ? (
              <EmptyState icon={<GitPullRequestArrow size={22} />} title={copy.workbench.noChanges} />
            ) : null}
          </div>
        ) : null}

        {activeTab === "terminal" ? <TerminalRunList copy={copy} runs={terminalEntries} /> : null}
      </div>
    </aside>
  );
}

function approvalParamEntries(params: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "");
}

function localizedApprovalParamKey(copy: AppCopy, key: string): string {
  const zh: Record<string, string> = {
    path: "路径",
    paths: "路径",
    query: "查询",
    pattern: "模式",
    question: "问题",
    reason: "原因",
    workspacePath: copy.workbench.workspacePath,
  };
  if (copy.language === "中" && zh[key]) return zh[key];
  return key;
}

function formatApprovalParamValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  if (typeof value === "object" && value) return "结构化参数";
  return String(value);
}

function reviewHeaderStatus(
  copy: AppCopy,
  changeCount: number,
  failedTerminalCount: number,
  pendingApprovalCount: number,
): { label: string; tone: "neutral" | "warning" | "danger" } {
  if (pendingApprovalCount > 0) return { label: copy.workbench.pendingApproval, tone: "warning" };
  if (changeCount > 0) return { label: copy.workbench.reviewHasChanges, tone: "warning" };
  if (failedTerminalCount > 0) return { label: copy.workbench.reviewHasTerminalIssues, tone: "danger" };
  return { label: copy.workbench.reviewReady, tone: "neutral" };
}
