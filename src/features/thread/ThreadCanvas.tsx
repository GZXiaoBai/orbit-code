import { MoreHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { AppCopy } from "../../i18n/copy";
import type { useWorkspace } from "../../state/useWorkspace";
import { Composer } from "../../components/Composer";
import { CodexThreadTimeline } from "../../components/thread/CodexThreadTimeline";
import { PlanSummary } from "../../components/thread/PlanSummary";
import { ThreadActionsMenu } from "./ThreadActionsMenu";
import { buildThreadScrollSignal, shouldFollowThreadScroll } from "./threadAutoScroll";
import { nextWorkbenchMode, shouldToggleModeFromKey } from "./threadModeShortcut";

type WorkspaceState = ReturnType<typeof useWorkspace>;

interface ThreadCanvasProps {
  copy: AppCopy;
  workspace: WorkspaceState;
  onOpenSettings: (section?: string) => void;
}

export function ThreadCanvas({ copy, workspace, onOpenSettings }: ThreadCanvasProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowScrollRef = useRef(true);
  const wasRunningRef = useRef(false);
  const plan = workspace.importedPlan?.plan;
  const isBuildMode = workspace.runControls.mode === "build";
  const codexThreadModel = workspace.codexThreadModel;
  const title = workspace.threadUiState.title || plan?.title || (codexThreadModel.itemCount > 0 ? "Orbit Codex" : copy.workbench.startEmptyTitle);
  const scrollSignal = buildThreadScrollSignal(codexThreadModel);
  const threadSummary = useMemo(() => {
    const taskCount = plan?.tasks.length || 0;
    return [
      `${copy.workbench.activeThread}: ${title}`,
      `${copy.workbench.headerProject}: ${workspace.workspaceRoot || copy.workbench.noWorkspace}`,
      `${copy.planTasks}: ${taskCount}`,
      `${copy.workbench.changesTab}: ${workspace.codexInspectorModel.counts.edits}`,
    ].join("\n");
  }, [copy, plan?.tasks.length, title, workspace.codexInspectorModel.counts.edits, workspace.workspaceRoot]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!shouldToggleModeFromKey(event.nativeEvent)) return;
    event.preventDefault();
    workspace.runControls.setMode(nextWorkbenchMode(workspace.runControls.mode));
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(threadSummary);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = threadSummary;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
  }

  function reviewHere() {
    if (!workspace.layoutPreferences.reviewDockVisible) workspace.toggleReviewDock();
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("orbit:focus-review-dock"));
    }, 80);
  }

  function updateScrollFollowState() {
    const element = scrollRef.current;
    if (!element) return;
    shouldFollowScrollRef.current = shouldFollowThreadScroll(element);
  }

  useEffect(() => {
    if (codexThreadModel.running && !wasRunningRef.current) {
      shouldFollowScrollRef.current = true;
    }
    wasRunningRef.current = codexThreadModel.running;
  }, [codexThreadModel.running]);

  useEffect(() => {
    if (!shouldFollowScrollRef.current) return;
    scrollEndRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
  }, [scrollSignal]);

  return (
    <section className="thread-canvas" aria-label={copy.workbench.activeThread} onKeyDown={handleKeyDown}>
      <header className="thread-canvas-header">
        <div>
          <span>{copy.workbench.activeThread}</span>
          <h1>{title}</h1>
        </div>
        <button
          type="button"
          aria-label={copy.workbench.threadActions}
          className={menuOpen ? "active" : ""}
          data-thread-menu-trigger="true"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <MoreHorizontal size={18} />
        </button>
        {menuOpen ? (
          <ThreadActionsMenu
            copy={copy}
            pinned={workspace.threadUiState.pinned}
            archived={workspace.threadUiState.archived}
            reviewDockVisible={workspace.layoutPreferences.reviewDockVisible}
            onClose={() => setMenuOpen(false)}
            onPin={workspace.togglePinnedThread}
            onRename={() => {
              const next = window.prompt(copy.workbench.renameThread, title);
              if (next !== null) workspace.renameThread(next);
            }}
            onArchive={() => workspace.archiveThread(!workspace.threadUiState.archived)}
            onToggleReviewDock={workspace.toggleReviewDock}
            onCopySummary={() => void copySummary()}
            onOpenNewWindow={workspace.openNewWindow}
          />
        ) : null}
      </header>

      <div className="thread-scroll" ref={scrollRef} onScroll={updateScrollFollowState}>
        <PlanSummary copy={copy} importedPlan={workspace.importedPlan} importError={workspace.importError} />

        <CodexThreadTimeline
          copy={copy}
          model={codexThreadModel}
          canStartBuild={isBuildMode}
          canContinue={workspace.canContinueCodexRun}
          onStartBuild={workspace.startAgentLoop}
          onContinue={workspace.continueAgentRun}
          onCancel={workspace.cancelAgentLoop}
          onAcceptPlanDraft={workspace.acceptPlanDraft}
          onOpenReviewDock={reviewHere}
          showReasoningProcess={workspace.layoutPreferences.showAgentReasoning}
        />
        <div ref={scrollEndRef} aria-hidden="true" />
      </div>

      <Composer
        copy={copy}
        onPlanImport={workspace.importPlan}
        onPlanMessage={workspace.submitPlanMessage}
        onBuildMessage={workspace.submitBuildMessage}
        runControls={workspace.runControls}
        onOpenSettings={onOpenSettings}
        workspaceRoot={workspace.workspaceRoot}
        projectPermissionPreset={workspace.projectSecurityOverride?.preset || workspace.effectiveSecurityPolicy.preset}
        onProjectPermissionChange={(preset) => void workspace.updateProjectSecurityOverride({ preset })}
        reviewPendingCount={workspace.codexInspectorModel.counts.edits}
        onReviewHere={reviewHere}
        submitDisabled={workspace.composerSubmitLocked}
        submitDisabledMessage={copy.composer.turnRunning}
      />
    </section>
  );
}
