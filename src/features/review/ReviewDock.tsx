import { useState } from "react";
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

type WorkspaceState = ReturnType<typeof useWorkspace>;
type DockTab = "files" | "tasks" | "changes" | "terminal";

interface ReviewDockProps {
  copy: AppCopy;
  theme: Theme;
  workspace: WorkspaceState;
}

export function ReviewDock({ copy, theme, workspace }: ReviewDockProps) {
  const [activeTab, setActiveTab] = useState<DockTab>("files");
  const model = workspace.reviewDockModel;
  const filePreview = useFilePreview(workspace.activeFilePath, workspace.activeFileContent);
  const tasks = workspace.importedPlan?.plan.tasks ?? [];
  const terminalRuns = model.terminalRuns;
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

  return (
    <aside className="review-dock" aria-label={copy.workbench.reviewDock}>
      <header className="review-dock-header">
        <strong>{copy.workbench.reviewDock}</strong>
        <StatusBadge tone={workspace.pendingApprovals.length > 0 ? "warning" : "neutral"}>
          {workspace.pendingApprovals.length > 0 ? copy.workbench.pendingApproval : copy.workbench.noApprovals}
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
                    <div>
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
            {workspace.runSteps.filter((step) => step.kind === "command" || step.kind === "patch").slice(-4).map((step) => (
              <article key={step.id} className={`dock-run-step dock-run-step-${step.status}`}>
                <header>
                  <div>
                    <strong>{step.title}</strong>
                    <small>{step.detail}</small>
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

            {model.appliedPatchReviews.length > 0 ? (
              <div className="dock-applied-history">
                <div className="dock-queue-heading">
                  <GitPullRequestArrow size={14} />
                  <strong>{copy.workbench.patchHistory}</strong>
                </div>
                {model.appliedPatchReviews.slice(-3).map((event) => (
                  <article key={event.id} className="dock-run-step dock-run-step-done">
                    <header>
                      <div>
                        <strong>{event.name}</strong>
                        <small>{event.patches?.map((patch) => patch.path).join(", ")}</small>
                      </div>
                      <StatusBadge tone="success">{copy.diff.allApplied}</StatusBadge>
                    </header>
                  </article>
                ))}
              </div>
            ) : null}

            <VerificationQueue
              copy={copy}
              approvals={model.verificationApprovals}
              workspaceRoot={workspace.workspaceRoot}
              onResolve={workspace.resolveApproval}
            />

            {model.otherApprovals.length > 0 ? (
              <div className="dock-queue-heading">
                <ShieldCheck size={14} />
                <strong>{copy.workbench.questionsAndGates}</strong>
              </div>
            ) : null}

            {model.otherApprovals.map((request) => (
              <article key={request.id} className="approval-request-card">
                <header>
                  <div>
                    <strong>{request.tool}</strong>
                    <small>{request.reason || copy.workbench.pendingApproval}</small>
                  </div>
                  <StatusBadge tone="warning">{copy.workbench.pendingApproval}</StatusBadge>
                </header>
                <pre>{JSON.stringify(request.params as Record<string, unknown>, null, 2)}</pre>
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
