import type { ActionRequiredEvent } from "../domain/actionRequired";
import type { TerminalRun } from "../domain/terminalRun";
import type { ThreadEvent } from "../domain/threadEvents";
import { updateToolCallLifecycle, type ToolCallLifecycle } from "../domain/toolCallLifecycle";
import { ActionRequiredStore } from "./actionRequiredStore";
import {
  restoreThreadEventStore,
  serializeRuntimeThreadEvents,
  updateThreadEventById,
} from "./threadEventStore";

export interface ThreadRuntimeSnapshot {
  threadEvents?: ThreadEvent[] | null;
  actionRequired?: ActionRequiredEvent[] | null;
  toolCalls?: ToolCallLifecycle[] | null;
  terminalRuns?: TerminalRun[] | null;
  checkpointRuntimeSnapshots?: Record<string, CheckpointRuntimeSnapshot> | null;
}

export interface ThreadRuntimeState {
  events: ThreadEvent[];
  actionRequired: ActionRequiredEvent[];
  toolCalls: ToolCallLifecycle[];
  terminalRuns: TerminalRun[];
  checkpointRuntimeSnapshots: Record<string, CheckpointRuntimeSnapshot>;
}

export interface RuntimeLedgerSnapshot {
  threadEvents: ThreadEvent[];
  actionRequired: ActionRequiredEvent[];
  toolCalls: ToolCallLifecycle[];
  terminalRuns: TerminalRun[];
  checkpoints: ThreadEvent[];
  checkpointRuntimeSnapshots: Record<string, CheckpointRuntimeSnapshot>;
}

export interface CheckpointRuntimeSnapshot {
  checkpointId: string;
  threadId?: string;
  workspacePath?: string;
  runtimeLedgerSnapshot: ThreadRuntimeSnapshot;
  agentRunSession?: unknown;
  createdAt: string;
}

export class RuntimeLedger {
  private state: ThreadRuntimeState;
  private actionStore: ActionRequiredStore;

  constructor(snapshot: ThreadRuntimeSnapshot = {}) {
    this.actionStore = new ActionRequiredStore({ actionRequired: snapshot.actionRequired });
    this.state = {
      events: restoreThreadEventStore({ threadEvents: snapshot.threadEvents }),
      actionRequired: this.actionStore.snapshot(),
      toolCalls: (snapshot.toolCalls || []).map((call) => ({ ...call })),
      terminalRuns: (snapshot.terminalRuns || []).map((run) => ({ ...run })),
      checkpointRuntimeSnapshots: { ...(snapshot.checkpointRuntimeSnapshots || {}) },
    };
  }

  appendThreadEvent(event: ThreadEvent): ThreadRuntimeState {
    this.state = {
      ...this.state,
      events: serializeRuntimeThreadEvents([...this.state.events, event]),
    };
    return this.snapshot();
  }

  updateThreadEvent(id: string, update: Partial<ThreadEvent> | ((event: ThreadEvent) => ThreadEvent)): ThreadRuntimeState {
    this.state = {
      ...this.state,
      events: updateThreadEventById(this.state.events, id, update),
    };
    return this.snapshot();
  }

  appendActionRequired(action: ActionRequiredEvent): ThreadRuntimeState {
    this.state = {
      ...this.state,
      actionRequired: this.actionStore.append(action),
    };
    return this.snapshot();
  }

  resolveActionRequired(id: string, resolution: Parameters<ActionRequiredStore["resolve"]>[1]): ThreadRuntimeState {
    this.state = {
      ...this.state,
      actionRequired: this.actionStore.resolve(id, resolution),
    };
    return this.snapshot();
  }

  updateActionRequired(id: string, update: Partial<ActionRequiredEvent> | ((event: ActionRequiredEvent) => ActionRequiredEvent)): ThreadRuntimeState {
    const next = this.state.actionRequired.map((event) => {
      if (event.id !== id) return event;
      return typeof update === "function" ? update(event) : { ...event, ...update };
    });
    this.actionStore = new ActionRequiredStore({ actionRequired: next });
    this.state = { ...this.state, actionRequired: this.actionStore.snapshot() };
    return this.snapshot();
  }

  expireActionRequired(now?: string): ThreadRuntimeState {
    this.state = {
      ...this.state,
      actionRequired: this.actionStore.expire(now),
    };
    return this.snapshot();
  }

  replayPending(): ActionRequiredEvent[] {
    return this.actionStore.replayPending();
  }

  appendToolCall(call: ToolCallLifecycle): ThreadRuntimeState {
    const exists = this.state.toolCalls.some((item) => item.id === call.id);
    this.state = {
      ...this.state,
      toolCalls: exists
        ? this.state.toolCalls.map((item) => item.id === call.id ? updateToolCallLifecycle(item, call) : item)
        : [{ ...call }, ...this.state.toolCalls],
    };
    return this.snapshot();
  }

  updateToolCall(id: string, update: Partial<ToolCallLifecycle> | ((call: ToolCallLifecycle) => ToolCallLifecycle)): ThreadRuntimeState {
    this.state = {
      ...this.state,
      toolCalls: this.state.toolCalls.map((call) => {
        if (call.id !== id) return call;
        return typeof update === "function" ? update(call) : updateToolCallLifecycle(call, update);
      }),
    };
    return this.snapshot();
  }

  appendTerminalRun(run: TerminalRun): ThreadRuntimeState {
    this.state = {
      ...this.state,
      terminalRuns: [{ ...run }, ...this.state.terminalRuns],
    };
    return this.snapshot();
  }

  saveCheckpointRuntimeSnapshot(input: CheckpointRuntimeSnapshot): ThreadRuntimeState {
    this.state = {
      ...this.state,
      checkpointRuntimeSnapshots: {
        ...this.state.checkpointRuntimeSnapshots,
        [input.checkpointId]: {
          ...input,
          runtimeLedgerSnapshot: {
            threadEvents: input.runtimeLedgerSnapshot.threadEvents?.map((event) => ({ ...event })),
            actionRequired: input.runtimeLedgerSnapshot.actionRequired?.map((action) => ({ ...action })),
            toolCalls: input.runtimeLedgerSnapshot.toolCalls?.map((call) => ({ ...call })),
            terminalRuns: input.runtimeLedgerSnapshot.terminalRuns?.map((run) => ({ ...run })),
          },
        },
      },
    };
    return this.snapshot();
  }

  serializeSnapshot(): ThreadRuntimeSnapshot {
    const snapshot = this.snapshot();
    const serialized: ThreadRuntimeSnapshot = {
      threadEvents: snapshot.events,
      actionRequired: snapshot.actionRequired,
      toolCalls: snapshot.toolCalls,
      terminalRuns: snapshot.terminalRuns,
    };
    if (Object.keys(snapshot.checkpointRuntimeSnapshots).length > 0) {
      serialized.checkpointRuntimeSnapshots = snapshot.checkpointRuntimeSnapshots;
    }
    return serialized;
  }

  append(event: ThreadEvent): ThreadRuntimeState {
    return this.appendThreadEvent(event);
  }

  appendItem(event: ThreadEvent): ThreadRuntimeState {
    return this.appendThreadEvent({ ...event, runtimeStatus: "started", status: "active" });
  }

  updateItem(id: string, update: Partial<ThreadEvent> | ((event: ThreadEvent) => ThreadEvent)): ThreadRuntimeState {
    return this.updateThreadEvent(id, (event) => {
      const explicitRuntimeStatus = typeof update === "function" ? undefined : update.runtimeStatus;
      const next = typeof update === "function" ? update(event) : { ...event, ...update };
      return {
        ...next,
        runtimeStatus: explicitRuntimeStatus || "updated",
        status: next.status || event.status,
      };
    });
  }

  completeItem(id: string, update: Partial<ThreadEvent> = {}): ThreadRuntimeState {
    return this.updateThreadEvent(id, (event) => ({
      ...event,
      ...update,
      runtimeStatus: "completed",
      status: "done",
    }));
  }

  failItem(id: string, error: string, update: Partial<ThreadEvent> = {}): ThreadRuntimeState {
    return this.updateThreadEvent(id, (event) => ({
      ...event,
      ...update,
      runtimeStatus: "failed",
      status: "done",
      kind: event.kind === "error" ? event.kind : event.kind,
      message: error,
    }));
  }

  update(id: string, update: Partial<ThreadEvent> | ((event: ThreadEvent) => ThreadEvent)): ThreadRuntimeState {
    return this.updateThreadEvent(id, update);
  }

  snapshot(): ThreadRuntimeState {
    return {
      events: serializeRuntimeThreadEvents(this.state.events),
      actionRequired: this.state.actionRequired.map((event) => ({ ...event })),
      toolCalls: this.state.toolCalls.map((call) => ({ ...call })),
      terminalRuns: this.state.terminalRuns.map((run) => ({ ...run })),
      checkpointRuntimeSnapshots: { ...this.state.checkpointRuntimeSnapshots },
    };
  }

  ledgerSnapshot(): RuntimeLedgerSnapshot {
    const snapshot = this.snapshot();
    return {
      threadEvents: snapshot.events,
      actionRequired: snapshot.actionRequired,
      toolCalls: snapshot.toolCalls,
      terminalRuns: snapshot.terminalRuns,
      checkpoints: snapshot.events.filter((event) => event.kind === "checkpoint" || Boolean(event.checkpoint)),
      checkpointRuntimeSnapshots: snapshot.checkpointRuntimeSnapshots,
    };
  }
}

export class ThreadRuntimeStore extends RuntimeLedger {}
