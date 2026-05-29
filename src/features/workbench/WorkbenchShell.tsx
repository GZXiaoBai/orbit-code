import { useCallback, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Languages, Moon, PanelRight, Settings, Sun } from "lucide-react";
import type { Language, Theme } from "../../domain/types";
import type { AppCopy } from "../../i18n/copy";
import type { useWorkspace } from "../../state/useWorkspace";
import { IconButton, StatusBadge } from "../../ui/primitives";
import { ApprovalOverlay } from "../approvals/ApprovalOverlay";
import { PatchReviewOverlay } from "../patches/PatchReviewOverlay";
import { ProjectRail } from "../projects/ProjectRail";
import { StructuredQuestionOverlay } from "../questions/StructuredQuestionOverlay";
import { ReviewDock } from "../review/ReviewDock";
import { ThreadCanvas } from "../thread/ThreadCanvas";

type WorkspaceState = ReturnType<typeof useWorkspace>;

interface WorkbenchShellProps {
  copy: AppCopy;
  language: Language;
  onLanguageChange: (language: Language) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  workspace: WorkspaceState;
  onOpenSettings: (section?: string) => void;
}

export function WorkbenchShell({
  copy,
  language,
  onLanguageChange,
  theme,
  onThemeChange,
  workspace,
  onOpenSettings,
}: WorkbenchShellProps) {
  const nextTheme = theme === "light" ? "dark" : "light";
  const providerLabel = workspace.runControls.selection.model
    ? workspace.runControls.selection.model
    : copy.workbench.providerMissing;
  const projectRailWidth = workspace.layoutPreferences.projectRailWidth || 274;
  const reviewDockWidth = workspace.layoutPreferences.reviewDockWidth || 360;

  const startWindowDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    const isHeaderDragRegion = Boolean(target?.closest("[data-tauri-drag-region='true']")) || event.clientY <= 46;
    if (!isHeaderDragRegion) return;
    if (target?.closest("button, a, input, textarea, select, [role='button'], [data-no-window-drag='true']")) {
      return;
    }

    void getCurrentWindow().startDragging().catch(() => {
      // CSS app-region remains as a fallback on platforms where explicit dragging is unavailable.
    });
  }, []);

  const startResize = useCallback((kind: "projectRail" | "reviewDock", event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startRail = workspace.layoutPreferences.projectRailWidth || 274;
    const startDock = workspace.layoutPreferences.reviewDockWidth || 360;
    const minRail = 220;
    const maxRail = 460;
    const minDock = 300;
    const maxDock = 620;
    const minThread = 390;

    document.body.classList.add("is-resizing-workbench");

    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));
    const onMove = (moveEvent: PointerEvent) => {
      const available = window.innerWidth - (workspace.layoutPreferences.reviewDockVisible ? startDock : 0) - minThread - 12;
      if (kind === "projectRail") {
        const maxAllowedRail = Math.max(minRail, Math.min(maxRail, available));
        workspace.updateLayoutPreferences({
          projectRailWidth: clamp(startRail + moveEvent.clientX - startX, minRail, maxAllowedRail),
        });
      } else {
        const maxAllowedDock = Math.max(minDock, Math.min(maxDock, window.innerWidth - startRail - minThread - 12));
        workspace.updateLayoutPreferences({
          reviewDockWidth: clamp(startDock - (moveEvent.clientX - startX), minDock, maxAllowedDock),
        });
      }
    };
    const onUp = () => {
      document.body.classList.remove("is-resizing-workbench");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, [workspace]);

  const resizeWithKeyboard = useCallback((kind: "projectRail" | "reviewDock", delta: number) => {
    if (kind === "projectRail") {
      workspace.updateLayoutPreferences({
        projectRailWidth: Math.min(460, Math.max(220, projectRailWidth + delta)),
      });
      return;
    }
    workspace.updateLayoutPreferences({
      reviewDockWidth: Math.min(620, Math.max(300, reviewDockWidth - delta)),
    });
  }, [projectRailWidth, reviewDockWidth, workspace]);

  return (
    <main
      className={`workbench-shell ${workspace.layoutPreferences.reviewDockVisible ? "" : "review-dock-hidden"}`}
      data-theme={theme}
      data-density={workspace.layoutPreferences.density}
      onPointerDown={startWindowDrag}
      style={{
        "--project-rail-width": `${projectRailWidth}px`,
        "--review-dock-width": `${reviewDockWidth}px`,
      } as CSSProperties}
    >
      <header className="workbench-header" data-tauri-drag-region="true">
        <div className="workbench-brand" data-tauri-drag-region="true">
          <span className="workbench-mark">OC</span>
          <div data-tauri-drag-region="true">
            <strong>Orbit Code</strong>
            <small>{copy.workspace}</small>
          </div>
        </div>

        <div className="workbench-project-chip" data-tauri-drag-region="true">
          <span>{copy.workbench.headerProject}</span>
          <strong>{workspace.workspaceRoot || copy.workbench.noWorkspace}</strong>
        </div>

        <StatusBadge tone={workspace.runControls.hasModelAccess && !workspace.runControls.missingCredential ? "success" : "warning"}>
          {providerLabel}
        </StatusBadge>

        <div className="workbench-header-actions" data-no-window-drag="true">
          <IconButton title={copy.langHint} onClick={() => onLanguageChange(language === "zh" ? "en" : "zh")}>
            <Languages size={16} />
          </IconButton>
          <IconButton title={copy.themeToggle} onClick={() => onThemeChange(nextTheme)}>
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </IconButton>
          <IconButton
            title={workspace.layoutPreferences.reviewDockVisible ? copy.workbench.hideReviewDock : copy.workbench.showReviewDock}
            onClick={workspace.toggleReviewDock}
          >
            <PanelRight size={16} />
          </IconButton>
          <IconButton title={copy.settings} onClick={() => onOpenSettings()}>
            <Settings size={16} />
          </IconButton>
        </div>
      </header>

      <div className="workbench-grid">
        <ProjectRail copy={copy} workspace={workspace} onOpenSettings={onOpenSettings} />
        <div
          className="workbench-resizer workbench-resizer-left"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize project rail"
          tabIndex={0}
          onPointerDown={(event) => startResize("projectRail", event)}
          onDoubleClick={() => workspace.updateLayoutPreferences({ projectRailWidth: 274 })}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") resizeWithKeyboard("projectRail", -16);
            if (event.key === "ArrowRight") resizeWithKeyboard("projectRail", 16);
          }}
        />
        <ThreadCanvas copy={copy} workspace={workspace} onOpenSettings={onOpenSettings} />
        <div
          className="workbench-resizer workbench-resizer-right"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize review dock"
          tabIndex={workspace.layoutPreferences.reviewDockVisible ? 0 : -1}
          aria-hidden={!workspace.layoutPreferences.reviewDockVisible}
          onPointerDown={(event) => {
            if (!workspace.layoutPreferences.reviewDockVisible) return;
            startResize("reviewDock", event);
          }}
          onDoubleClick={() => workspace.updateLayoutPreferences({ reviewDockWidth: 360 })}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") resizeWithKeyboard("reviewDock", -16);
            if (event.key === "ArrowRight") resizeWithKeyboard("reviewDock", 16);
          }}
        />
        {workspace.layoutPreferences.reviewDockVisible ? (
          <ReviewDock copy={copy} theme={theme} workspace={workspace} />
        ) : null}
      </div>
      <StructuredQuestionOverlay
        copy={copy}
        questions={workspace.pendingQuestions}
        onAnswer={workspace.answerQuestion}
        onCancel={workspace.cancelQuestion}
      />
      <ApprovalOverlay
        copy={copy}
        approvals={workspace.pendingApprovals}
        workspaceRoot={workspace.workspaceRoot}
        onResolve={workspace.resolveApproval}
        onGrantScopeChange={workspace.updateApprovalGrantScope}
      />
      <PatchReviewOverlay
        copy={copy}
        events={workspace.reviewDockModel.patchReviews}
        workspacePath={workspace.workspaceRoot}
        onApply={workspace.applyEventPatch}
        onUpdatePatch={workspace.updateEventPatch}
      />
    </main>
  );
}
