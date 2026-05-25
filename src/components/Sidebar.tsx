import {
  Search,
  Settings,
  FileCode2,
  FolderOpen,
  RefreshCcw,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { AppCopy } from "../i18n/copy";

interface SidebarProps {
  copy: AppCopy;
  onOpenSettings?: () => void;
  workspaceRoot?: string;
  workspaceError?: string | null;
  workspaceFiles?: string[];
  activeFilePath?: string | null;
  onViewFile?: (path: string) => void;
  onWorkspaceRootChange?: (path: string) => Promise<boolean>;
  onRefreshWorkspace?: () => Promise<void>;
  onBuildEmbeddings?: () => void;
  embeddingBuildProgress?: {
    phase: string;
    current: number;
    total: number;
    message: string;
  } | null;
  onNewWindow?: () => void;
}

export function Sidebar({ 
  copy, 
  onOpenSettings,
  workspaceRoot = "",
  workspaceError = null,
  workspaceFiles = [],
  activeFilePath = null,
  onViewFile,
  onWorkspaceRootChange,
  onRefreshWorkspace,
  onBuildEmbeddings,
  embeddingBuildProgress,
  onNewWindow,
}: SidebarProps) {
  const [draftRoot, setDraftRoot] = useState(workspaceRoot);
  const [isApplyingRoot, setIsApplyingRoot] = useState(false);

  useEffect(() => {
    setDraftRoot(workspaceRoot);
  }, [workspaceRoot]);

  const applyWorkspaceRoot = async () => {
    if (!onWorkspaceRootChange) return;
    setIsApplyingRoot(true);
    try {
      await onWorkspaceRootChange(draftRoot);
    } finally {
      setIsApplyingRoot(false);
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-title">
        <strong>{copy.navTitle}</strong>
        <span>{copy.projects}</span>
      </div>

      <div className="sidebar-actions">
        {onOpenSettings && (
          <button className="icon-button" onClick={onOpenSettings} title={copy.sidebar.settingsTitle}>
            <Settings size={20} />
          </button>
        )}
      </div>

      {onNewWindow && (
        <div className="sidebar-new-window">
          <button
            onClick={onNewWindow}
            className="sidebar-new-window-btn"
            title={copy.sidebar.newWindowTitle}
          >
            + {copy.sidebar.newWindow}
          </button>
        </div>
      )}



      <section className="workspace-root-section">
        <div className="workspace-root-label">
          <FolderOpen size={14} />
          <span>{copy.sidebar.workspaceRoot}</span>
        </div>
        <div className="workspace-root-row">
          <input
            value={draftRoot}
            onChange={(event) => setDraftRoot(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyWorkspaceRoot();
              }
            }}
            placeholder={copy.sidebar.workspaceRootPlaceholder}
            aria-label={copy.sidebar.workspaceRoot}
          />
          <button
            type="button"
            onClick={applyWorkspaceRoot}
            disabled={isApplyingRoot || !draftRoot.trim()}
            title={copy.sidebar.applyWorkspaceRoot}
          >
            {isApplyingRoot ? "..." : copy.sidebar.apply}
          </button>
        </div>
        {workspaceError && <p className="workspace-root-error">{workspaceError}</p>}
      </section>

      <section className="workspace-file-list-section">
        <div className="workspace-file-list-header">
          <h2>{copy.sidebar.workspaceFiles}</h2>
          {onRefreshWorkspace && (
            <button
              type="button"
              onClick={onRefreshWorkspace}
              title={copy.sidebar.refreshWorkspace}
            >
              <RefreshCcw size={13} />
            </button>
          )}
        </div>
        <div className="workspace-file-list">
          {workspaceFiles.length > 0 ? (
            workspaceFiles.map((file) => (
              <button
                key={file}
                className={`file-item-row ${activeFilePath === file ? "active" : ""}`}
                onClick={() => onViewFile?.(file)}
                title={file}
              >
                <FileCode2 size={14} />
                <span>{file}</span>
              </button>
            ))
          ) : (
            <div className="empty-files">
              <FileCode2 size={18} />
              <span>{copy.sidebar.noWorkspaceFiles}</span>
            </div>
          )}
        </div>
      </section>

      <button className="settings-button" type="button" onClick={onOpenSettings}>
        <Settings size={18} />
        <span>{copy.settings}</span>
      </button>

      {onBuildEmbeddings && (
        <div
          className="sidebar-index-panel"
        >
          {embeddingBuildProgress ? (
            <div
              className="sidebar-index-progress"
            >
              {embeddingBuildProgress.message}
            </div>
          ) : (
            <button
              onClick={onBuildEmbeddings}
              className="sidebar-index-btn"
              title={copy.sidebar.buildIndexTitle}
            >
              <Search size={12} />
              {copy.sidebar.buildIndex}
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
