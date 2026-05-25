import type { ThreadUiState } from "../domain/types";

export function threadIdFor(workspacePath: string, title: string): string {
  return workspacePath || title || "empty-thread";
}

export function createThreadId(workspacePath: string): string {
  const scope = workspacePath || "empty";
  return `${scope}::thread-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function getThreadUiState(
  state: Record<string, ThreadUiState>,
  threadId: string,
  workspacePath?: string,
): ThreadUiState {
  return state[threadId] || {
    threadId,
    workspacePath,
    updatedAt: new Date(0).toISOString(),
  };
}

export function listThreadsForWorkspace(
  state: Record<string, ThreadUiState>,
  workspacePath: string,
): ThreadUiState[] {
  return Object.values(state)
    .filter((thread) => thread.workspacePath === workspacePath && !thread.archived)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
}

export function groupThreadsByWorkspace(state: Record<string, ThreadUiState>): Record<string, ThreadUiState[]> {
  return Object.values(state).reduce<Record<string, ThreadUiState[]>>((groups, thread) => {
    if (!thread.workspacePath || thread.archived) return groups;
    const threads = groups[thread.workspacePath] || [];
    groups[thread.workspacePath] = [...threads, thread];
    return groups;
  }, {});
}

export function upsertThreadUiState(
  state: Record<string, ThreadUiState>,
  threadId: string,
  patch: Partial<ThreadUiState>,
): Record<string, ThreadUiState> {
  return {
    ...state,
    [threadId]: {
      ...getThreadUiState(state, threadId, patch.workspacePath),
      ...patch,
      threadId,
      updatedAt: new Date().toISOString(),
    },
  };
}
