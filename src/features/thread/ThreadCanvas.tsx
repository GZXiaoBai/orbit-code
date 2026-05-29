import { Bot, MoreHorizontal } from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";
import type { AppCopy } from "../../i18n/copy";
import type { useWorkspace } from "../../state/useWorkspace";
import { selectCenterTimeline } from "../../domain/threadEventSelectors";
import { Composer } from "../../components/Composer";
import { AgentTimeline } from "../../components/thread/AgentTimeline";
import { PlanSummary } from "../../components/thread/PlanSummary";
import { EmptyState } from "../../ui/primitives";
import { ThreadActionsMenu } from "./ThreadActionsMenu";
import { nextWorkbenchMode, shouldToggleModeFromKey } from "./threadModeShortcut";

type WorkspaceState = ReturnType<typeof useWorkspace>;

interface ThreadCanvasProps {
  copy: AppCopy;
  workspace: WorkspaceState;
  onOpenSettings: (section?: string) => void;
}

export function ThreadCanvas({ copy, workspace, onOpenSettings }: ThreadCanvasProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const plan = workspace.importedPlan?.plan;
  const isBuildMode = workspace.runControls.mode === "build";
  const title = workspace.threadUiState.title || plan?.title || copy.workbench.startEmptyTitle;
  const centerThreadEvents = useMemo(() => selectCenterTimeline(workspace.threadEvents), [workspace.threadEvents]);
  const threadSummary = useMemo(() => {
    const taskCount = plan?.tasks.length || 0;
    return [
      `${copy.workbench.activeThread}: ${title}`,
      `${copy.workbench.headerProject}: ${workspace.workspaceRoot || copy.workbench.noWorkspace}`,
      `${copy.planTasks}: ${taskCount}`,
      `${copy.workbench.changesTab}: ${workspace.threadEvents.length}`,
    ].join("\n");
  }, [copy, plan?.tasks.length, title, workspace.threadEvents.length, workspace.workspaceRoot]);

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

      <div className="thread-scroll">
        {!plan && workspace.threadEvents.length === 0 ? (
          <EmptyState
            icon={<Bot size={24} />}
            title={copy.workbench.startEmptyTitle}
            body={copy.workbench.startEmptyBody}
          />
        ) : null}

        <PlanSummary copy={copy} importedPlan={workspace.importedPlan} importError={workspace.importError} />

        <AgentTimeline
          copy={copy}
          threadEvents={centerThreadEvents}
          agentLoopPhase={workspace.agentLoopPhase}
          agentLoopRunning={workspace.agentLoopRunning}
          agentLoopToolCalls={workspace.agentLoopToolCalls}
          pendingApprovals={workspace.pendingApprovals}
          pendingQuestions={workspace.pendingQuestions}
          pendingPatchEvents={workspace.reviewDockModel.patchReviews}
          onStartAgentLoop={isBuildMode ? workspace.startAgentLoop : undefined}
          onContinueAgentRun={workspace.continueAgentRun}
          canContinueAgentRun={Boolean(workspace.agentRunSession.canContinue)}
          onCancelAgentLoop={workspace.cancelAgentLoop}
          onRestartCollaboration={workspace.startCollaborationFlow}
          onApplyEventPatch={workspace.applyEventPatch}
          onRefinePatch={workspace.refinePatch}
          onUpdatePatch={workspace.updateEventPatch}
          onAcceptPlanDraft={workspace.acceptPlanDraft}
          streamingContent={workspace.streamingContent}
          streamingActive={workspace.streamingActive}
        />
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
        reviewPendingCount={workspace.reviewDockModel.counts.changes}
        onReviewHere={reviewHere}
      />
    </section>
  );
}
