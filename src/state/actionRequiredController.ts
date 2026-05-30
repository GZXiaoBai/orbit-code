import { useCallback, useRef } from "react";
import {
  actionRequiredResolution,
  createActionRequiredEvent,
  resolveActionRequiredEvent,
  type ActionRequiredEvent,
  type ActionRequiredResolution,
  type ActionResolution,
} from "../domain/actionRequired";
import type { ThreadEvent } from "../domain/threadEvents";
import { RuntimeLedger } from "./threadRuntimeStore";

export type ActionRequiredRequestInput =
  Omit<ActionRequiredEvent, "id" | "status" | "createdAt"> & {
    id?: string;
    status?: ActionRequiredEvent["status"];
    createdAt?: string;
  };

export interface ActionRequiredController {
  request(input: ActionRequiredRequestInput): Promise<ActionRequiredResolution>;
  resolve(id: string, resolution: ActionResolution): ActionRequiredResolution;
  cancel(id: string, reason?: string): ActionRequiredResolution;
  expire(now?: string): ActionRequiredEvent[];
  replayPending(): ActionRequiredEvent[];
}

export interface ActionRequiredControllerOptions {
  getThreadEvents: () => ThreadEvent[];
  getActions: () => ActionRequiredEvent[];
  appendAction: (action: ActionRequiredEvent) => void;
  updateAction: (id: string, action: ActionRequiredEvent) => void;
  setActions: (next: ActionRequiredEvent[]) => void;
}

export interface ActionRequiredControllerCoreOptions {
  getThreadEvents: () => ThreadEvent[];
  getActions: () => ActionRequiredEvent[];
  appendAction: (action: ActionRequiredEvent) => void;
  updateAction: (id: string, action: ActionRequiredEvent) => void;
  setActions: (next: ActionRequiredEvent[]) => void;
  resolvers?: Map<string, (resolution: ActionRequiredResolution) => void>;
}

export class ActionRequiredControllerCore implements ActionRequiredController {
  private resolvers: Map<string, (resolution: ActionRequiredResolution) => void>;

  constructor(private readonly options: ActionRequiredControllerCoreOptions) {
    this.resolvers = options.resolvers || new Map();
  }

  request(input: ActionRequiredRequestInput): Promise<ActionRequiredResolution> {
    const action = createActionRequiredEvent(input);
    this.options.appendAction(action);

    return new Promise<ActionRequiredResolution>((resolve) => {
      this.resolvers.set(action.id, resolve);
    });
  }

  resolve(id: string, resolution: ActionResolution): ActionRequiredResolution {
    const current = this.options.getActions().find((action) => action.id === id);
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
    const liveResolver = this.resolvers.get(id);
    const result = {
      ...actionRequiredResolution(resolved),
      hadLiveResolver: Boolean(liveResolver),
    };
    if (current) {
      this.options.updateAction(id, resolved);
    } else {
      this.options.appendAction(resolved);
    }

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
    const next = new RuntimeLedger({
      threadEvents: this.options.getThreadEvents(),
      actionRequired: this.options.getActions(),
    }).expireActionRequired(now).actionRequired;
    this.options.setActions(next);
    return next;
  }

  replayPending(): ActionRequiredEvent[] {
    return new RuntimeLedger({
      threadEvents: this.options.getThreadEvents(),
      actionRequired: this.options.getActions(),
    }).replayPending();
  }
}

export function useActionRequiredController({
  getThreadEvents,
  getActions,
  appendAction,
  updateAction,
  setActions,
}: ActionRequiredControllerOptions): ActionRequiredController {
  const resolversRef = useRef(new Map<string, (resolution: ActionRequiredResolution) => void>());

  const request = useCallback((input: ActionRequiredRequestInput) => {
    return new ActionRequiredControllerCore({
      getThreadEvents,
      getActions,
      appendAction,
      updateAction,
      setActions,
      resolvers: resolversRef.current,
    }).request(input);
  }, [appendAction, getActions, getThreadEvents, setActions, updateAction]);

  const resolve = useCallback((id: string, resolution: ActionResolution) => {
    return new ActionRequiredControllerCore({
      getThreadEvents,
      getActions,
      appendAction,
      updateAction,
      setActions,
      resolvers: resolversRef.current,
    }).resolve(id, resolution);
  }, [appendAction, getActions, getThreadEvents, setActions, updateAction]);

  const cancel = useCallback((id: string, reason = "User cancelled this action.") => {
    return resolve(id, { status: "cancelled", reason });
  }, [resolve]);

  const expire = useCallback((now?: string) => new ActionRequiredControllerCore({
    getThreadEvents,
    getActions,
    appendAction,
    updateAction,
    setActions,
    resolvers: resolversRef.current,
  }).expire(now), [appendAction, getActions, getThreadEvents, setActions, updateAction]);

  const replayPending = useCallback(() => new ActionRequiredControllerCore({
    getThreadEvents,
    getActions,
    appendAction,
    updateAction,
    setActions,
    resolvers: resolversRef.current,
  }).replayPending(), [appendAction, getActions, getThreadEvents, setActions, updateAction]);

  return {
    request,
    resolve,
    cancel,
    expire,
    replayPending,
  };
}
