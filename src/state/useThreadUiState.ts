import { useCallback, useEffect, useMemo, useState } from "react";
import type { ThreadUiState } from "../domain/types";
import {
  createThreadId,
  getThreadUiState,
  groupThreadsByWorkspace,
  listThreadsForWorkspace,
  threadIdFor,
  upsertThreadUiState,
} from "./threadUiState";

const STORAGE_KEY = "agent-gui.thread-ui-state.v1";
const ACTIVE_THREAD_KEY = "orbit-code.active-thread-by-workspace.v1";

function loadThreadUiState(): Record<string, ThreadUiState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, ThreadUiState>;
  } catch {
    return {};
  }
}

function loadActiveThreadByWorkspace(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ACTIVE_THREAD_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

export function useThreadUiState(workspacePath: string, title: string) {
  const [threadUiStateMap, setThreadUiStateMap] = useState<Record<string, ThreadUiState>>(() => loadThreadUiState());
  const [activeThreadByWorkspace, setActiveThreadByWorkspace] = useState<Record<string, string>>(() => loadActiveThreadByWorkspace());
  const fallbackThreadId = useMemo(() => threadIdFor(workspacePath, title), [workspacePath, title]);
  const threadId = activeThreadByWorkspace[workspacePath] || fallbackThreadId;
  const threadUiState = useMemo(
    () => getThreadUiState(threadUiStateMap, threadId, workspacePath),
    [threadId, threadUiStateMap, workspacePath],
  );
  const threadList = useMemo(() => {
    const threads = listThreadsForWorkspace(threadUiStateMap, workspacePath);
    const hasActive = threads.some((thread) => thread.threadId === threadId);
    const active = getThreadUiState(threadUiStateMap, threadId, workspacePath);
    return hasActive ? threads : [active, ...threads];
  }, [threadId, threadUiStateMap, workspacePath]);
  const threadsByProject = useMemo(() => groupThreadsByWorkspace(threadUiStateMap), [threadUiStateMap]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(threadUiStateMap));
  }, [threadUiStateMap]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_THREAD_KEY, JSON.stringify(activeThreadByWorkspace));
  }, [activeThreadByWorkspace]);

  useEffect(() => {
    if (!workspacePath) return;
    setThreadUiStateMap((prev) => {
      if (prev[threadId]) return prev;
      return upsertThreadUiState(prev, threadId, {
        workspacePath,
        title: title === "default-thread" ? undefined : title,
      });
    });
  }, [threadId, title, workspacePath]);

  const updateThreadUiState = useCallback((patch: Partial<ThreadUiState>) => {
    setThreadUiStateMap((prev) => upsertThreadUiState(prev, threadId, { ...patch, workspacePath }));
  }, [threadId, workspacePath]);

  const updateThreadUiStateById = useCallback((targetThreadId: string, patch: Partial<ThreadUiState>) => {
    if (!targetThreadId) return;
    setThreadUiStateMap((prev) => upsertThreadUiState(prev, targetThreadId, {
      ...patch,
      workspacePath: patch.workspacePath ?? prev[targetThreadId]?.workspacePath ?? workspacePath,
    }));
  }, [workspacePath]);

  const togglePinnedThread = useCallback(() => {
    setThreadUiStateMap((prev) => upsertThreadUiState(prev, threadId, {
      workspacePath,
      pinned: !prev[threadId]?.pinned,
    }));
  }, [threadId, workspacePath]);

  const togglePinnedThreadById = useCallback((targetThreadId: string) => {
    if (!targetThreadId) return;
    setThreadUiStateMap((prev) => upsertThreadUiState(prev, targetThreadId, {
      workspacePath: prev[targetThreadId]?.workspacePath ?? workspacePath,
      pinned: !prev[targetThreadId]?.pinned,
    }));
  }, [workspacePath]);

  const renameThread = useCallback((title: string) => {
    updateThreadUiState({ title: title.trim() || undefined });
  }, [updateThreadUiState]);

  const renameThreadById = useCallback((targetThreadId: string, title: string) => {
    updateThreadUiStateById(targetThreadId, { title: title.trim() || undefined });
  }, [updateThreadUiStateById]);

  const archiveThread = useCallback((archived = true) => {
    updateThreadUiState({ archived });
  }, [updateThreadUiState]);

  const archiveThreadById = useCallback((targetThreadId: string, archived = true) => {
    updateThreadUiStateById(targetThreadId, { archived });
  }, [updateThreadUiStateById]);

  const deleteThread = useCallback((targetThreadId: string) => {
    if (!targetThreadId) return;
    setThreadUiStateMap((prev) => {
      const next = { ...prev };
      delete next[targetThreadId];
      return next;
    });
  }, []);

  const switchThread = useCallback((nextThreadId: string) => {
    if (!workspacePath) return;
    setActiveThreadByWorkspace((prev) => ({ ...prev, [workspacePath]: nextThreadId }));
  }, [workspacePath]);

  const createThread = useCallback((title?: string) => {
    const nextThreadId = createThreadId(workspacePath);
    setThreadUiStateMap((prev) => upsertThreadUiState(prev, nextThreadId, {
      workspacePath,
      title,
    }));
    setActiveThreadByWorkspace((prev) => ({ ...prev, [workspacePath]: nextThreadId }));
    return nextThreadId;
  }, [workspacePath]);

  return {
    threadId,
    threadUiState,
    threadList,
    threadsByProject,
    updateThreadUiState,
    updateThreadUiStateById,
    togglePinnedThread,
    togglePinnedThreadById,
    renameThread,
    renameThreadById,
    archiveThread,
    archiveThreadById,
    deleteThread,
    switchThread,
    createThread,
  };
}
