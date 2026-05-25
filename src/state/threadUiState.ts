import type { ThreadUiState } from "../domain/types";

export function threadIdFor(workspacePath: string, title: string): string {
  return workspacePath || title || "empty-thread";
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
