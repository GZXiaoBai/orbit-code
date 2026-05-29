import type { ActionRequiredEvent, ActionResolution } from "../domain/actionRequired";
import {
  replayPendingActionRequired,
  resolveActionRequiredEvent,
} from "../domain/actionRequired";

export interface ActionRequiredSnapshot {
  actionRequired?: ActionRequiredEvent[] | null;
}

export class ActionRequiredStore {
  private actions: ActionRequiredEvent[];

  constructor(snapshot: ActionRequiredSnapshot = {}) {
    this.actions = serializeActionRequired(snapshot.actionRequired || []);
  }

  append(action: ActionRequiredEvent): ActionRequiredEvent[] {
    this.actions = serializeActionRequired([action, ...this.actions]);
    return this.snapshot();
  }

  resolve(id: string, resolution: ActionResolution): ActionRequiredEvent[] {
    this.actions = serializeActionRequired(this.actions.map((action) =>
      action.id === id ? resolveActionRequiredEvent(action, resolution) : action
    ));
    return this.snapshot();
  }

  expire(now = new Date().toISOString()): ActionRequiredEvent[] {
    this.actions = serializeActionRequired(this.actions.map((action) => {
      if (action.status !== "pending" || !action.expiresAt || action.expiresAt > now) return action;
      return resolveActionRequiredEvent(action, {
        status: "expired",
        resolvedAt: now,
        reason: "No user decision was provided before the request expired.",
      });
    }));
    return this.snapshot();
  }

  replayPending(): ActionRequiredEvent[] {
    return replayPendingActionRequired(this.actions);
  }

  snapshot(): ActionRequiredEvent[] {
    return serializeActionRequired(this.actions);
  }
}

export function serializeActionRequired(actions: ActionRequiredEvent[]): ActionRequiredEvent[] {
  return actions.map((action) => ({ ...action }));
}
