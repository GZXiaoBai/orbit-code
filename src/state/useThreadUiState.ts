import { useCallback, useEffect, useMemo, useState } from "react";
import type { ThreadUiState } from "../domain/types";
import { getThreadUiState, threadIdFor, upsertThreadUiState } from "./threadUiState";

const STORAGE_KEY = "agent-gui.thread-ui-state.v1";

function loadThreadUiState(): Record<string, ThreadUiState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, ThreadUiState>;
  } catch {
    return {};
  }
}

export function useThreadUiState(workspacePath: string, title: string) {
  const [threadUiStateMap, setThreadUiStateMap] = useState<Record<string, ThreadUiState>>(() => loadThreadUiState());
  const threadId = useMemo(() => threadIdFor(workspacePath, title), [workspacePath, title]);
  const threadUiState = useMemo(
    () => getThreadUiState(threadUiStateMap, threadId, workspacePath),
    [threadId, threadUiStateMap, workspacePath],
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(threadUiStateMap));
  }, [threadUiStateMap]);

  const updateThreadUiState = useCallback((patch: Partial<ThreadUiState>) => {
    setThreadUiStateMap((prev) => upsertThreadUiState(prev, threadId, { ...patch, workspacePath }));
  }, [threadId, workspacePath]);

  const togglePinnedThread = useCallback(() => {
    setThreadUiStateMap((prev) => upsertThreadUiState(prev, threadId, {
      workspacePath,
      pinned: !prev[threadId]?.pinned,
    }));
  }, [threadId, workspacePath]);

  const renameThread = useCallback((title: string) => {
    updateThreadUiState({ title: title.trim() || undefined });
  }, [updateThreadUiState]);

  const archiveThread = useCallback((archived = true) => {
    updateThreadUiState({ archived });
  }, [updateThreadUiState]);

  return {
    threadId,
    threadUiState,
    updateThreadUiState,
    togglePinnedThread,
    renameThread,
    archiveThread,
  };
}
