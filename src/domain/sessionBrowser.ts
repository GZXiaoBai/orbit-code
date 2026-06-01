import type { ActionRequiredEvent } from "./actionRequired";
import type { TerminalRun } from "./terminalRun";
import type { ThreadEvent } from "./threadEvents";
import type { ThreadUiState } from "./types";

export interface CodexSessionSnapshot {
  threadEvents?: ThreadEvent[];
  actionRequired?: ActionRequiredEvent[];
  terminalRuns?: TerminalRun[];
}

export interface SessionBrowserItem {
  threadId: string;
  workspacePath: string;
  title: string;
  lastActiveAt: string;
  eventCount: number;
  pendingActionCount: number;
  lastSummary: string;
  archived: boolean;
  pinned?: boolean;
}

export interface SessionBrowserModel {
  sessions: SessionBrowserItem[];
  selected?: SessionBrowserItem;
  searchQuery: string;
  restorePreview?: {
    threadId: string;
    eventCount: number;
    pendingActionCount: number;
    lastSummary: string;
    lastTerminalState?: string;
    lastCheckpointId?: string;
    explicitContinueRequired: boolean;
    mode: "pending-action" | "read-only" | "empty";
  };
  errors: string[];
}

export interface SessionBrowserSnapshotLike {
  codexSnapshot?: CodexSessionSnapshot | null;
  threadEvents?: ThreadEvent[];
  actionRequired?: ActionRequiredEvent[];
  updatedAt?: string;
}

function eventSummary(event?: ThreadEvent): string {
  if (!event) return "";
  return event.message || event.title || event.kind;
}

function pendingCount(snapshot?: SessionBrowserSnapshotLike): number {
  const actions = snapshot?.codexSnapshot?.actionRequired || snapshot?.actionRequired || [];
  return actions.filter((action) => action.status === "pending").length;
}

function eventsFor(snapshot?: SessionBrowserSnapshotLike): ThreadEvent[] {
  return snapshot?.codexSnapshot?.threadEvents || snapshot?.threadEvents || [];
}

export function buildSessionBrowserModel(input: {
  threads: ThreadUiState[];
  snapshots: Record<string, SessionBrowserSnapshotLike>;
  workspacePath: string;
  activeThreadId?: string;
  searchQuery?: string;
}): SessionBrowserModel {
  const query = (input.searchQuery || "").trim().toLocaleLowerCase();
  const seen = new Set<string>();
  const baseThreads = input.threads.filter((thread) => {
    if (!input.workspacePath) return false;
    return thread.workspacePath === input.workspacePath;
  });
  const snapshotThreads: ThreadUiState[] = Object.entries(input.snapshots)
    .filter(([threadId]) => !baseThreads.some((thread) => thread.threadId === threadId))
    .map(([threadId, snapshot]) => ({
      threadId,
      workspacePath: input.workspacePath,
      title: undefined,
      archived: false,
      updatedAt: snapshot.updatedAt || new Date(0).toISOString(),
    } satisfies ThreadUiState));

  const sessions = [...baseThreads, ...snapshotThreads]
    .filter((thread) => {
      if (seen.has(thread.threadId)) return false;
      seen.add(thread.threadId);
      return query || !thread.archived;
    })
    .map<SessionBrowserItem>((thread) => {
      const snapshot = input.snapshots[thread.threadId];
      const events = eventsFor(snapshot);
      const lastEvent = events[events.length - 1];
      return {
        threadId: thread.threadId,
        workspacePath: thread.workspacePath || input.workspacePath,
        title: thread.title || "Untitled thread",
        lastActiveAt: snapshot?.updatedAt || thread.updatedAt,
        eventCount: events.length,
        pendingActionCount: pendingCount(snapshot),
        lastSummary: eventSummary(lastEvent),
        archived: Boolean(thread.archived),
        pinned: thread.pinned,
      };
    })
    .filter((item) => {
      if (!query) return true;
      return [
        item.title,
        item.lastSummary,
        item.threadId,
      ].some((value) => value.toLocaleLowerCase().includes(query));
    })
    .sort((a, b) => {
      if (a.archived !== b.archived) return a.archived ? 1 : -1;
      if (a.pendingActionCount !== b.pendingActionCount) return b.pendingActionCount - a.pendingActionCount;
      return Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt);
    });

  const selected = sessions.find((item) => item.threadId === input.activeThreadId) || sessions[0];
  const selectedSnapshot = selected ? input.snapshots[selected.threadId] : undefined;
  const selectedEvents = eventsFor(selectedSnapshot);
  const selectedPendingCount = pendingCount(selectedSnapshot);
  const terminalRuns = selectedSnapshot?.codexSnapshot?.terminalRuns || [];
  const lastTerminal = terminalRuns[terminalRuns.length - 1];
  const checkpointEvents = selectedEvents.filter((event) => event.checkpoint?.checkpointId || event.kind === "checkpoint");
  const lastCheckpoint = checkpointEvents[checkpointEvents.length - 1]?.checkpoint;

  return {
    sessions,
    selected,
    searchQuery: input.searchQuery || "",
    restorePreview: selected ? {
      threadId: selected.threadId,
      eventCount: selectedEvents.length,
      pendingActionCount: selectedPendingCount,
      lastSummary: selected.lastSummary,
      lastTerminalState: lastTerminal?.recoveredState || lastTerminal?.status,
      lastCheckpointId: lastCheckpoint?.checkpointId,
      explicitContinueRequired: selectedPendingCount > 0
        || lastTerminal?.recoveredState === "unknown-needs-continue",
      mode: selectedPendingCount > 0 ? "pending-action" : selectedEvents.length > 0 ? "read-only" : "empty",
    } : undefined,
    errors: [],
  };
}
