import {
  actionRequiredResolution,
  createActionRequiredEvent,
  resolveActionRequiredEvent,
  type ActionRequiredEvent,
  type ActionRequiredResolution,
  type ActionResolution,
} from "../domain/actionRequired";
import { RuntimeLedger } from "./threadRuntimeStore";

export type ActionBusRequestInput =
  Omit<ActionRequiredEvent, "id" | "status" | "createdAt"> & {
    id?: string;
    status?: ActionRequiredEvent["status"];
    createdAt?: string;
  };

export interface ActionBusSnapshot {
  actions: ActionRequiredEvent[];
}

export class ActionBus {
  private actions: ActionRequiredEvent[];
  private resolvers = new Map<string, (resolution: ActionRequiredResolution) => void>();

  constructor(snapshot: Partial<ActionBusSnapshot> = {}) {
    this.actions = (snapshot.actions || []).map((action) => ({ ...action }));
  }

  snapshot(): ActionBusSnapshot {
    return {
      actions: this.actions.map((action) => ({ ...action })),
    };
  }

  request(input: ActionBusRequestInput): Promise<ActionRequiredResolution> {
    const action = createActionRequiredEvent(input);
    this.actions = [action, ...this.actions];
    return new Promise((resolve) => {
      this.resolvers.set(action.id, resolve);
    });
  }

  resolve(id: string, resolution: ActionResolution): ActionRequiredResolution {
    const current = this.actions.find((action) => action.id === id);
    const resolved = current
      ? resolveActionRequiredEvent(current, resolution)
      : createActionRequiredEvent({
        id,
        kind: "command",
        title: "Recovered Action",
        description: resolution.reason || "Recovered action was resolved.",
        status: resolution.status || (resolution.approved === false ? "denied" : "resolved"),
        toolResultText: resolution.toolResultText,
      });
    if (current) {
      this.actions = this.actions.map((action) => action.id === id ? resolved : action);
    } else {
      this.actions = [resolved, ...this.actions];
    }
    const result = actionRequiredResolution(resolved);
    const liveResolver = this.resolvers.get(id);
    if (liveResolver) {
      liveResolver(result);
      this.resolvers.delete(id);
    }
    return result;
  }

  cancel(id: string, reason = "User cancelled this action."): ActionRequiredResolution {
    return this.resolve(id, { status: "cancelled", reason });
  }

  expire(now?: string): ActionRequiredEvent[] {
    this.actions = new RuntimeLedger({ actionRequired: this.actions }).expireActionRequired(now).actionRequired;
    return this.snapshot().actions;
  }

  replayPending(): ActionRequiredEvent[] {
    return new RuntimeLedger({ actionRequired: this.actions }).replayPending();
  }
}
