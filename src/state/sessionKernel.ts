import type { ActionRequiredEvent } from "../domain/actionRequired";
import { buildSessionBrowserModel, type SessionBrowserModel, type SessionBrowserSnapshotLike } from "../domain/sessionBrowser";
import type { ThreadUiState } from "../domain/types";
import type { ImportedPlanState } from "./useSession";
import { SessionRestoreController, type SessionRestoreInput, type SessionRestoreResult } from "./sessionRestoreController";
import { createThreadId } from "./threadUiState";
import { RuntimeLedger, type ThreadRuntimeSnapshot } from "./threadRuntimeStore";

export interface SessionKernelSnapshot extends SessionBrowserSnapshotLike {
  importedPlan?: ImportedPlanState | null;
}

export interface CleanSessionRuntime {
  importedPlan: null;
  runtimeLedgerSnapshot: ThreadRuntimeSnapshot;
  agentRunSession: null;
  actionRequired: ActionRequiredEvent[];
}

export interface SessionKernelCreateResult {
  thread: ThreadUiState;
  cleanRuntime: CleanSessionRuntime;
}

export class SessionKernel {
  constructor(private readonly restoreController = new SessionRestoreController()) {}

  listSessions(input: {
    threads: ThreadUiState[];
    snapshots: Record<string, SessionKernelSnapshot>;
    workspacePath: string;
    activeThreadId?: string;
    searchQuery?: string;
  }): SessionBrowserModel {
    return buildSessionBrowserModel(input);
  }

  createSession(workspacePath: string, title?: string, at = new Date().toISOString()): SessionKernelCreateResult {
    const threadId = createThreadId(workspacePath);
    return {
      thread: {
        threadId,
        workspacePath,
        title,
        updatedAt: at,
      },
      cleanRuntime: createCleanSessionRuntime(),
    };
  }

  restoreSession(input: SessionRestoreInput): SessionRestoreResult {
    return this.restoreController.restore(input);
  }

  archiveSession(
    threads: Record<string, ThreadUiState>,
    threadId: string,
    archived = true,
    at = new Date().toISOString(),
  ): Record<string, ThreadUiState> {
    const current = threads[threadId];
    if (!current) return threads;
    return {
      ...threads,
      [threadId]: {
        ...current,
        archived,
        updatedAt: at,
      },
    };
  }

  deleteSession<TSnapshot>(
    threads: Record<string, ThreadUiState>,
    snapshots: Record<string, TSnapshot>,
    threadId: string,
  ): { threads: Record<string, ThreadUiState>; snapshots: Record<string, TSnapshot> } {
    const nextThreads = { ...threads };
    const nextSnapshots = { ...snapshots };
    delete nextThreads[threadId];
    delete nextSnapshots[threadId];
    return { threads: nextThreads, snapshots: nextSnapshots };
  }
}

export function createCleanSessionRuntime(): CleanSessionRuntime {
  return {
    importedPlan: null,
    runtimeLedgerSnapshot: new RuntimeLedger().serializeSnapshot(),
    agentRunSession: null,
    actionRequired: [],
  };
}

export function restoreKernelSession(
  input: SessionRestoreInput,
  restoreController = new SessionRestoreController(),
): SessionRestoreResult {
  return restoreController.restore(input);
}

export function sessionNeedsExplicitContinue(result: SessionRestoreResult): boolean {
  return result.explicitContinueRequired || result.resumeResults.length > 0;
}
