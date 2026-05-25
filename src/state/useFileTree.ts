import { useCallback, useEffect, useMemo, useState } from "react";
import type { FileTreeUiState } from "../domain/types";
import {
  addRecentFile,
  buildFileTree,
  defaultExpandedDirs,
  filterFileTree,
  parentDirsForPath,
  type FileTreeNode,
} from "../domain/fileTree";

const STORAGE_KEY = "orbit-code.file-tree-ui.v1";

export interface FileTreeState {
  nodes: FileTreeNode[];
  filteredNodes: FileTreeNode[];
  expandedDirs: Set<string>;
  selectedFilePath?: string;
  recentFiles: string[];
  filter: string;
  setFilter: (filter: string) => void;
  toggleDir: (path: string) => void;
  expandDir: (path: string) => void;
  selectFile: (path: string) => void;
}

function loadTreeState(workspacePath: string): FileTreeUiState | null {
  if (!workspacePath) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, FileTreeUiState>;
    return parsed[workspacePath] || null;
  } catch {
    return null;
  }
}

function saveTreeState(workspacePath: string, patch: Partial<FileTreeUiState>) {
  if (!workspacePath) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, FileTreeUiState> : {};
    const current: FileTreeUiState = parsed[workspacePath] || {
      workspacePath,
      expandedDirs: [],
      recentFiles: [],
      filter: "",
      updatedAt: new Date().toISOString(),
    };
    parsed[workspacePath] = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
      workspacePath,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Local persistence is best-effort only.
  }
}

export function useFileTree(workspacePath: string, workspaceFiles: string[], activeFilePath?: string | null): FileTreeState {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => {
    const stored = loadTreeState(workspacePath);
    return stored ? new Set(stored.expandedDirs) : defaultExpandedDirs(workspaceFiles, activeFilePath);
  });
  const [recentFiles, setRecentFiles] = useState<string[]>(() => loadTreeState(workspacePath)?.recentFiles || []);
  const [filter, setFilterState] = useState(() => loadTreeState(workspacePath)?.filter || "");

  const nodes = useMemo(() => buildFileTree(workspaceFiles), [workspaceFiles]);
  const filteredNodes = useMemo(() => filterFileTree(nodes, filter), [filter, nodes]);

  useEffect(() => {
    const stored = loadTreeState(workspacePath);
    setExpandedDirs(stored ? new Set(stored.expandedDirs) : defaultExpandedDirs(workspaceFiles, activeFilePath));
    setRecentFiles(stored?.recentFiles || []);
    setFilterState(stored?.filter || "");
  }, [workspacePath]);

  useEffect(() => {
    if (!workspacePath) return;
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      for (const dir of defaultExpandedDirs(workspaceFiles, activeFilePath)) next.add(dir);
      return next;
    });
  }, [activeFilePath, workspaceFiles, workspacePath]);

  useEffect(() => {
    if (!activeFilePath) return;
    setRecentFiles((prev) => {
      const next = addRecentFile(prev, activeFilePath);
      saveTreeState(workspacePath, { recentFiles: next, selectedFilePath: activeFilePath });
      return next;
    });
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      for (const dir of parentDirsForPath(activeFilePath)) next.add(dir);
      saveTreeState(workspacePath, { expandedDirs: [...next], selectedFilePath: activeFilePath });
      return next;
    });
  }, [activeFilePath, workspacePath]);

  const setFilter = useCallback((nextFilter: string) => {
    setFilterState(nextFilter);
    saveTreeState(workspacePath, { filter: nextFilter });
  }, [workspacePath]);

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      saveTreeState(workspacePath, { expandedDirs: [...next] });
      return next;
    });
  }, [workspacePath]);

  const expandDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev).add(path);
      saveTreeState(workspacePath, { expandedDirs: [...next] });
      return next;
    });
  }, [workspacePath]);

  const selectFile = useCallback((path: string) => {
    setRecentFiles((prev) => {
      const nextRecentFiles = addRecentFile(prev, path);
      saveTreeState(workspacePath, { recentFiles: nextRecentFiles, selectedFilePath: path });
      return nextRecentFiles;
    });
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      for (const dir of parentDirsForPath(path)) next.add(dir);
      saveTreeState(workspacePath, { expandedDirs: [...next], selectedFilePath: path });
      return next;
    });
  }, [workspacePath]);

  return {
    nodes,
    filteredNodes,
    expandedDirs,
    selectedFilePath: activeFilePath || undefined,
    recentFiles,
    filter,
    setFilter,
    toggleDir,
    expandDir,
    selectFile,
  };
}
