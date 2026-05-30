import type { ThreadUiState } from "../domain/types";
import type { SessionBrowserModel } from "../domain/sessionBrowser";
import { SessionRestoreController, type SessionRestoreInput, type SessionRestoreResult } from "./sessionRestoreController";
import {
  createCleanSessionRuntime,
  SessionKernel,
  type CleanSessionRuntime,
  type SessionKernelSnapshot,
} from "./sessionKernel";

export type PiSessionEntryKind =
  | "message"
  | "model_change"
  | "thinking_level_change"
  | "compaction"
  | "branch_summary"
  | "custom_runtime";

export interface PiSessionEntry<TPayload = unknown> {
  id: string;
  parentId: string | null;
  threadId: string;
  kind: PiSessionEntryKind;
  payload: TPayload;
  createdAt: string;
}

export interface PiSessionRuntime {
  thread: ThreadUiState;
  cleanRuntime: CleanSessionRuntime;
  entries: PiSessionEntry[];
}

export interface PiSessionViewInput {
  threads: ThreadUiState[];
  snapshots: Record<string, SessionKernelSnapshot>;
  workspacePath: string;
  activeThreadId?: string;
  searchQuery?: string;
}

export class PiSessionKernel {
  private readonly legacyKernel: SessionKernel;

  constructor(legacyKernel?: SessionKernel, restoreController?: SessionRestoreController) {
    this.legacyKernel = legacyKernel || new SessionKernel(restoreController);
  }

  listSessions(input: PiSessionViewInput): SessionBrowserModel {
    return this.legacyKernel.listSessions(input);
  }

  createSession(workspacePath: string, title?: string, at = new Date().toISOString()): PiSessionRuntime {
    const created = this.legacyKernel.createSession(workspacePath, title, at);
    return {
      ...created,
      entries: [],
    };
  }

  switchSession(input: SessionRestoreInput): SessionRestoreResult {
    return this.legacyKernel.restoreSession(input);
  }

  restoreSession(input: SessionRestoreInput): SessionRestoreResult {
    return this.switchSession(input);
  }

  renameSession(
    threads: Record<string, ThreadUiState>,
    threadId: string,
    title: string,
    at = new Date().toISOString(),
  ): Record<string, ThreadUiState> {
    const current = threads[threadId];
    if (!current) return threads;
    return {
      ...threads,
      [threadId]: {
        ...current,
        title,
        updatedAt: at,
      },
    };
  }

  archiveSession(
    threads: Record<string, ThreadUiState>,
    threadId: string,
    archived = true,
    at = new Date().toISOString(),
  ): Record<string, ThreadUiState> {
    return this.legacyKernel.archiveSession(threads, threadId, archived, at);
  }

  deleteSession<TSnapshot>(
    threads: Record<string, ThreadUiState>,
    snapshots: Record<string, TSnapshot>,
    threadId: string,
  ): { threads: Record<string, ThreadUiState>; snapshots: Record<string, TSnapshot> } {
    return this.legacyKernel.deleteSession(threads, snapshots, threadId);
  }

  forkSession(input: {
    source: PiSessionRuntime;
    entryId: string;
    threadId: string;
    title?: string;
    at?: string;
  }): PiSessionRuntime {
    const at = input.at || new Date().toISOString();
    const selectedIndex = input.source.entries.findIndex((entry) => entry.id === input.entryId);
    const keptEntries = selectedIndex >= 0
      ? input.source.entries.slice(0, selectedIndex + 1)
      : input.source.entries;
    return {
      thread: {
        ...input.source.thread,
        threadId: input.threadId,
        title: input.title || input.source.thread.title,
        updatedAt: at,
      },
      cleanRuntime: createCleanSessionRuntime(),
      entries: keptEntries.map((entry) => ({
        ...entry,
        threadId: input.threadId,
      })),
    };
  }
}

export const createCleanPiSessionRuntime = createCleanSessionRuntime;
