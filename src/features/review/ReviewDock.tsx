import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BookOpenText, FileCode2, GitPullRequestArrow } from "lucide-react";
import type { Theme } from "../../domain/types";
import type { TerminalRun } from "../../domain/terminalRun";
import type { AppCopy } from "../../i18n/copy";
import type { useWorkspace } from "../../state/useWorkspace";
import { useFilePreview } from "../../state/useFilePreview";
import { EmptyState, StatusBadge, Tabs } from "../../ui/primitives";
import { CodePreview } from "./CodePreview";
import { PatchReviewQueue } from "./PatchReviewQueue";
import { TerminalRunList } from "./TerminalRunList";
import { localizedAgentEventName, localizedRuntimeText } from "../../components/thread/agentDisplayText";

type WorkspaceState = ReturnType<typeof useWorkspace>;
type DockTab = "files" | "changes" | "terminal" | "context";

interface ReviewDockProps {
  copy: AppCopy;
  theme: Theme;
  workspace: WorkspaceState;
}

export function ReviewDock({ copy, theme, workspace }: ReviewDockProps) {
  const [activeTab, setActiveTab] = useState<DockTab>("files");
  const [editingContextPath, setEditingContextPath] = useState("ORBIT.md");
  const [contextDraft, setContextDraft] = useState("");
  const [contextSaveState, setContextSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [smokeRecord, setSmokeRecord] = useState<ReturnType<WorkspaceState["evaluateDeepSeekSmokeRun"]> | null>(null);
  const didAutoSelectTab = useRef(false);
  const model = workspace.reviewDockModel;
  const filePreview = useFilePreview(workspace.activeFilePath, workspace.activeFileContent);
  const terminalRuns = model.terminalRuns.length > 0
    ? model.terminalRuns
    : model.historyTerminalRuns;
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
  const contextInspector = workspace.currentContextInspector;
  const editableContext = contextInspector.editableSources.find((source) => source.path === editingContextPath)
    || contextInspector.editableSources[0];
  const activeChangeSteps = useMemo(
    () => workspace.runSteps
      .filter((step) => (step.kind === "command" || step.kind === "patch") && step.status !== "done")
      .slice(-4),
    [workspace.runSteps],
  );
  const headerStatus = reviewHeaderStatus(copy, model.counts.changes, failedTerminalCount, workspace.pendingActions.length);

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

  useEffect(() => {
    if (!editableContext) return;
    setContextDraft(editableContext.content);
    setContextSaveState("idle");
  }, [editableContext?.path, editableContext?.content]);

  const saveContextFile = async () => {
    if (!editableContext) return;
    setContextSaveState("saving");
    try {
      await workspace.writeProjectContextFile(editableContext.path, contextDraft);
      setContextSaveState("saved");
    } catch {
      setContextSaveState("error");
    }
  };

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
          { id: "changes", label: copy.workbench.changesTab, count: model.counts.changes },
          { id: "terminal", label: copy.workbench.terminalTab, count: terminalEntries.length },
          { id: "context", label: copy.workbench.contextTab, count: contextInspector.blocks.length },
        ]}
      />

      <div className="review-dock-body">
        {activeTab === "files" ? (
          workspace.activeFilePath && workspace.activeFileContent !== null ? (
            <CodePreview copy={copy} preview={filePreview} workspacePath={workspace.workspaceRoot} theme={theme} onClose={() => workspace.viewFile("")} />
          ) : (
            <EmptyState icon={<FileCode2 size={22} />} title={copy.workbench.noFileSelected} />
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

            <PatchReviewQueue
              copy={copy}
              events={model.patchReviews}
              onApply={workspace.applyEventPatch}
              onUpdatePatch={workspace.updateEventPatch}
              workspacePath={workspace.workspaceRoot}
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
                        <strong>{localizedAgentEventName(copy, event.title)}</strong>
                        <small>{event.patches?.map((patch) => patch.path).join(", ")}</small>
                      </div>
                      <div className="dock-run-step-actions">
                        <StatusBadge tone={failed ? "danger" : "success"}>
                          {failed ? copy.workbench.patchFailed : copy.diff.allApplied}
                        </StatusBadge>
                        {event.checkpoint?.checkpointId ? (
                          <button type="button" onClick={() => void workspace.rollbackEventPatch(event.id)}>
                            {copy.language === "中" ? "回滚" : "Rollback"}
                          </button>
                        ) : null}
                      </div>
                    </header>
                  </article>
                  );
                })}
              </div>
            ) : null}

            {model.counts.changes === 0 ? (
              <EmptyState icon={<GitPullRequestArrow size={22} />} title={copy.workbench.noChanges} />
            ) : null}
          </div>
        ) : null}

        {activeTab === "terminal" ? <TerminalRunList copy={copy} runs={terminalEntries} /> : null}

        {activeTab === "context" ? (
          <div className="dock-context" data-testid="current-context-inspector">
            <div className="dock-context-summary">
              <BookOpenText size={18} />
              <div>
                <strong>{copy.workbench.currentContext}</strong>
                <small>
                  {copy.workbench.contextMode}: {contextInspector.mode}
                  {" · "}
                  {copy.workbench.contextTokens}: {contextInspector.tokenEstimate}
                  {" · "}
                  {copy.workbench.permissionImpact}: {copy.workbench.permissionNone}
                </small>
              </div>
            </div>

            <section className="dock-context-editor">
              <header>
                <div>
                  <strong>{copy.language === "中" ? "DeepSeek 闭环验收" : "DeepSeek smoke gate"}</strong>
                  <small>
                    {copy.language === "中"
                      ? "根据当前线程事件和阻塞动作生成可记录的 smoke 结果。"
                      : "Evaluate the current thread events and blocking actions into a smoke record."}
                  </small>
                </div>
                <button type="button" className="btn" onClick={() => setSmokeRecord(workspace.evaluateDeepSeekSmokeRun())}>
                  {copy.language === "中" ? "评估当前线程" : "Evaluate thread"}
                </button>
              </header>
              {smokeRecord ? (
                <article className={`dock-context-block ${smokeRecord.result === "passed" ? "" : "disabled"}`}>
                  <header>
                    <strong>{smokeRecord.result === "passed" ? "passed" : "failed"}</strong>
                    <StatusBadge tone={smokeRecord.result === "passed" ? "success" : "danger"}>{smokeRecord.model}</StatusBadge>
                  </header>
                  <small>{smokeRecord.workspacePath}</small>
                  {smokeRecord.failure ? <p>{smokeRecord.failure.summary} {smokeRecord.failure.nextFix}</p> : null}
                  {smokeRecord.missingStages.length > 0 ? <small>missing: {smokeRecord.missingStages.join(", ")}</small> : null}
                  {smokeRecord.terminalSummary ? <small>{smokeRecord.terminalSummary}</small> : null}
                </article>
              ) : null}
            </section>

            {workspace.workspaceRoot ? (
              <section className="dock-context-editor">
                <header>
                  <div>
                    <strong>{copy.settingsModal.projectContextRules}</strong>
                    <small>{copy.settingsModal.projectContextRulesHelp}</small>
                  </div>
                  <button type="button" className="btn" onClick={() => void workspace.refreshCurrentContext()}>
                    {copy.settingsModal.refreshContext}
                  </button>
                </header>
                <div className="dock-context-editor-tabs">
                  {contextInspector.editableSources.map((source) => (
                    <button
                      key={source.path}
                      type="button"
                      className={editingContextPath === source.path ? "active" : ""}
                      onClick={() => setEditingContextPath(source.path)}
                    >
                      {source.path}
                      {!source.exists ? <small>{copy.settingsModal.newFile}</small> : null}
                    </button>
                  ))}
                </div>
                {editableContext ? (
                  <>
                    <textarea
                      value={contextDraft}
                      onChange={(event) => setContextDraft(event.target.value)}
                      placeholder={copy.settingsModal.contextRuleContent}
                    />
                    <div className="dock-context-editor-actions">
                      <button type="button" className="btn btn-save" onClick={() => void saveContextFile()} disabled={contextSaveState === "saving"}>
                        {contextSaveState === "saving" ? copy.diff.writing : copy.settingsModal.saveContextFile}
                      </button>
                      <small>
                        {contextSaveState === "saved" ? copy.settingsModal.saved : contextSaveState === "error" ? copy.settingsModal.saveFailed : copy.settingsModal.projectContextSafety}
                      </small>
                    </div>
                  </>
                ) : null}
              </section>
            ) : null}

            {contextInspector.errors.length > 0 ? (
              <div className="dock-context-errors">
                {contextInspector.errors.map((error) => (
                  <article key={`${error.providerId}-${error.message}`} className="dock-context-error">
                    <AlertTriangle size={14} />
                    <span>{error.providerId}: {error.message}</span>
                  </article>
                ))}
              </div>
            ) : null}

            {contextInspector.blocks.length > 0 ? (
              <div className="dock-context-blocks">
                {contextInspector.blocks.map((block) => (
                  <article key={block.id} className="dock-context-block">
                    <header>
                      <strong>{block.title}</strong>
                      <StatusBadge tone="neutral">{block.source}</StatusBadge>
                    </header>
                    <small>
                      {copy.workbench.contextTokens}: {block.tokenEstimate || 0}
                      {block.matchedRules?.length ? ` · ${copy.workbench.matchedRules}: ${block.matchedRules.join(", ")}` : ""}
                    </small>
                    <pre>{block.content}</pre>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState icon={<BookOpenText size={22} />} title={copy.workbench.noContextBlocks} />
            )}

            {contextInspector.disabledBlocks.length > 0 ? (
              <div className="dock-context-blocks">
                <div className="dock-queue-heading">
                  <BookOpenText size={14} />
                  <strong>{copy.settingsModal.disabledContextBlocks}</strong>
                </div>
                {contextInspector.disabledBlocks.map((block) => (
                  <article key={`disabled-${block.id}`} className="dock-context-block disabled">
                    <header>
                      <strong>{block.title}</strong>
                      <StatusBadge tone="neutral">{block.source}</StatusBadge>
                    </header>
                    <small>{copy.workbench.contextMode}: {block.mode}</small>
                  </article>
                ))}
              </div>
            ) : null}

            {contextInspector.externalRuleCandidates.length > 0 ? (
              <div className="dock-context-blocks">
                <div className="dock-queue-heading">
                  <BookOpenText size={14} />
                  <strong>{copy.language === "中" ? "外部规则导入候选" : "External Rule Candidates"}</strong>
                </div>
                {contextInspector.externalRuleCandidates.map((candidate) => (
                  <article key={candidate.path} className="dock-context-block disabled">
                    <header>
                      <strong>{candidate.title}</strong>
                      <StatusBadge tone="neutral">{copy.language === "中" ? "未启用" : "Disabled"}</StatusBadge>
                    </header>
                    <small>{candidate.path}</small>
                  </article>
                ))}
              </div>
            ) : null}

            {contextInspector.skills.length > 0 ? (
              <div className="dock-context-blocks">
                <div className="dock-queue-heading">
                  <BookOpenText size={14} />
                  <strong>{copy.settingsModal.contextSkills}</strong>
                </div>
                {contextInspector.skills.map((skill) => (
                  <article key={skill.path} className="dock-context-block">
                    <header>
                      <strong>{skill.name}</strong>
                      <StatusBadge tone="neutral">{skill.modeSlugs?.join(", ") || copy.settingsModal.contextModeBoth}</StatusBadge>
                    </header>
                    <small>{skill.path}</small>
                    <p>{skill.description}</p>
                  </article>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
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
