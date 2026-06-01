import { useEffect, useRef, useState } from "react";
import { AlertTriangle, BookOpenText, FileCode2, FilePenLine, GitPullRequestArrow, ShieldQuestion, TerminalSquare } from "lucide-react";
import type { Theme } from "../../domain/types";
import type { CodexInspectableItem } from "../../domain/codex";
import type { TerminalRun } from "../../domain/terminalRun";
import type { AppCopy } from "../../i18n/copy";
import type { useWorkspace } from "../../state/useWorkspace";
import { useFilePreview } from "../../state/useFilePreview";
import { EmptyState, StatusBadge, Tabs } from "../../ui/primitives";
import { CodePreview } from "./CodePreview";
import { PatchReviewQueue } from "./PatchReviewQueue";
import { TerminalRunList } from "./TerminalRunList";

type WorkspaceState = ReturnType<typeof useWorkspace>;
type DockTab = "files" | "actions" | "edits" | "terminal" | "context";

interface ReviewDockProps {
  copy: AppCopy;
  theme: Theme;
  workspace: WorkspaceState;
}

function itemStatusLabel(copy: AppCopy, item: CodexInspectableItem) {
  if (item.kind === "question" && item.status === "completed") return copy.language === "中" ? "已回答" : "Answered";
  if (item.kind === "question" && item.status === "denied") return copy.language === "中" ? "已取消" : "Cancelled";
  if (item.kind === "approval" && item.status === "completed") return copy.language === "中" ? "已批准" : "Approved";
  if (item.kind === "approval" && item.status === "denied") return copy.language === "中" ? "已拒绝" : "Denied";
  if (item.status === "pending") return copy.workbench.pendingApproval;
  if (item.status === "running") return copy.thread.thinking;
  if (item.status === "failed") return copy.language === "中" ? "失败" : "Failed";
  return copy.language === "中" ? "完成" : "Done";
}

function itemKindLabel(copy: AppCopy, item: CodexInspectableItem) {
  if (item.kind === "question") return copy.workbench.agentQuestion;
  if (item.kind === "approval") return copy.workbench.authorizationRequired;
  if (item.kind === "fileEdit") return copy.language === "中" ? "Codex 文件编辑" : "Codex file edit";
  if (item.kind === "terminal") return copy.workbench.terminalTab;
  if (item.kind === "usage") return copy.language === "中" ? "Token 使用量" : "Token usage";
  if (item.kind === "reasoning") return copy.language === "中" ? "推理摘要" : "Reasoning";
  if (item.kind === "error") return copy.language === "中" ? "错误" : "Error";
  return item.title;
}

function focusActionOverlay() {
  requestAnimationFrame(() => {
    const dialog = document.querySelector<HTMLElement>(".approval-dialog");
    dialog?.focus();
    dialog?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

function ActionItemCard({ copy, item }: { copy: AppCopy; item: CodexInspectableItem }) {
  const params = item.metadata?.params && typeof item.metadata.params === "object"
    ? JSON.stringify(item.metadata.params, null, 2)
    : "";
  const answer = typeof item.metadata?.answer === "string" ? item.metadata.answer : "";
  return (
    <article className={`codex-inspector-card codex-inspector-card-${item.tone}`} data-review-focus={item.status === "pending" || item.status === "running" ? "pending" : undefined}>
      <header>
        <div>
          <strong>{itemKindLabel(copy, item)}</strong>
          <small>{item.title}</small>
        </div>
        <StatusBadge tone={item.tone}>{itemStatusLabel(copy, item)}</StatusBadge>
      </header>
      <p>{item.text}</p>
      {answer ? <small className="codex-inspector-meta">{copy.workbench.answerQuestion}: {answer}</small> : null}
      {params ? <pre>{params}</pre> : null}
      {(item.status === "pending" || item.status === "running") ? (
        <button type="button" className="btn" onClick={focusActionOverlay}>
          {copy.language === "中" ? "打开处理弹窗" : "Open action overlay"}
        </button>
      ) : null}
    </article>
  );
}

function UsageStrip({ copy, workspace }: { copy: AppCopy; workspace: WorkspaceState }) {
  const usage = workspace.codexInspectorModel.usage;
  if (usage.totalTokens <= 0) return null;
  return (
    <div className="codex-usage-strip">
      <span>{copy.workbench.contextTokens}</span>
      <strong>{usage.totalTokens}</strong>
      <small>in {usage.inputTokens} / out {usage.outputTokens}</small>
    </div>
  );
}

export function ReviewDock({ copy, theme, workspace }: ReviewDockProps) {
  const [activeTab, setActiveTab] = useState<DockTab>("files");
  const [editingContextPath, setEditingContextPath] = useState("ORBIT.md");
  const [contextDraft, setContextDraft] = useState("");
  const [contextSaveState, setContextSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [smokeRecord, setSmokeRecord] = useState<ReturnType<WorkspaceState["evaluateDeepSeekSmokeRun"]> | null>(null);
  const didAutoSelectTab = useRef(false);
  const model = workspace.codexInspectorModel;
  const filePreview = useFilePreview(workspace.activeFilePath, workspace.activeFileContent);
  const terminalEntries: TerminalRun[] = model.terminalRuns.length > 0 ? model.terminalRuns : Object.entries(workspace.terminalLogs).map(([taskId, output]) => ({
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
  const headerStatus = reviewHeaderStatus(copy, model.counts.edits, failedTerminalCount, model.counts.pendingActions);

  useEffect(() => {
    if (didAutoSelectTab.current) return;
    if (model.counts.pendingActions > 0) {
      didAutoSelectTab.current = true;
      setActiveTab("actions");
    } else if (model.counts.edits > 0) {
      didAutoSelectTab.current = true;
      setActiveTab("edits");
    } else if (failedTerminalCount > 0) {
      didAutoSelectTab.current = true;
      setActiveTab("terminal");
    }
  }, [failedTerminalCount, model.counts.edits, model.counts.pendingActions]);

  useEffect(() => {
    const focusReviewDock = () => {
      setActiveTab(model.counts.pendingActions > 0 ? "actions" : model.counts.edits > 0 ? "edits" : "terminal");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const dock = document.querySelector(".review-dock");
          const target = dock?.querySelector<HTMLElement>("[data-review-focus='pending'], .codex-inspector-card, .dock-diff-card, .dock-terminal");
          target?.scrollIntoView({ block: "center", behavior: "smooth" });
          target?.classList.add("review-focus-pulse");
          window.setTimeout(() => target?.classList.remove("review-focus-pulse"), 1200);
        });
      });
    };
    window.addEventListener("orbit:focus-review-dock", focusReviewDock);
    return () => window.removeEventListener("orbit:focus-review-dock", focusReviewDock);
  }, [model.counts.edits, model.counts.pendingActions]);

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
    <aside className="review-dock codex-inspector" aria-label={copy.workbench.reviewDock}>
      <header className="review-dock-header">
        <div>
          <strong>{copy.workbench.reviewDock}</strong>
          <small>{copy.language === "中" ? "Codex items" : "Codex items"}</small>
        </div>
        <StatusBadge tone={headerStatus.tone}>
          {headerStatus.label}
        </StatusBadge>
      </header>

      <Tabs
        active={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: "files", label: copy.workbench.filesTab },
          { id: "actions", label: copy.language === "中" ? "动作" : "Actions", count: model.counts.actions },
          { id: "edits", label: copy.workbench.changesTab, count: model.counts.edits },
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

        {activeTab === "actions" ? (
          <div className="codex-inspector-list">
            {model.actions.map((item) => <ActionItemCard key={item.id} copy={copy} item={item} />)}
            <UsageStrip copy={copy} workspace={workspace} />
            {model.errors.map((item) => (
              <article key={item.id} className="codex-inspector-card codex-inspector-card-danger">
                <header>
                  <div>
                    <strong>{itemKindLabel(copy, item)}</strong>
                    <small>{item.title}</small>
                  </div>
                  <StatusBadge tone="danger">{itemStatusLabel(copy, item)}</StatusBadge>
                </header>
                <p>{item.text}</p>
              </article>
            ))}
            {model.actions.length === 0 && model.errors.length === 0 ? (
              <EmptyState icon={<ShieldQuestion size={22} />} title={copy.workbench.noApprovals} />
            ) : null}
          </div>
        ) : null}

        {activeTab === "edits" ? (
          <div className="dock-changes codex-inspector-list">
            <div className="dock-queue-heading">
              <FilePenLine size={14} />
              <strong>{copy.language === "中" ? "Codex 文件编辑" : "Codex file edits"}</strong>
            </div>
            <PatchReviewQueue
              copy={copy}
              events={model.patchEvents}
              onApply={workspace.applyEventPatch}
              onUpdatePatch={workspace.updateEventPatch}
              workspacePath={workspace.workspaceRoot}
            />
            {model.edits.length > 0 && model.patchEvents.length === 0 ? (
              model.edits.map((item) => (
                <article key={item.id} className="dock-diff-card codex-inspector-card">
                  <header>
                    <div>
                      <strong>{item.title}</strong>
                      <small>{item.text}</small>
                    </div>
                    <StatusBadge tone={item.tone}>{itemStatusLabel(copy, item)}</StatusBadge>
                  </header>
                </article>
              ))
            ) : null}
            {model.counts.edits === 0 ? (
              <EmptyState icon={<GitPullRequestArrow size={22} />} title={copy.workbench.noChanges} />
            ) : null}
          </div>
        ) : null}

        {activeTab === "terminal" ? (
          <div className="codex-inspector-list">
            <div className="dock-queue-heading">
              <TerminalSquare size={14} />
              <strong>{copy.workbench.terminalTab}</strong>
            </div>
            <TerminalRunList copy={copy} runs={terminalEntries} />
          </div>
        ) : null}

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
                      ? "根据当前 Codex items 和阻塞动作生成可记录的 smoke 结果。"
                      : "Evaluate the current Codex items and blocking actions into a smoke record."}
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
                      {block.matchReason ? ` · ${block.matchReason}` : ""}
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
                    <small>
                      {copy.workbench.contextMode}: {block.mode}
                      {block.matchReason ? ` · ${block.matchReason}` : ""}
                    </small>
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
