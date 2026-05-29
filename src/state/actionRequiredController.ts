import { useCallback, useRef, type SetStateAction } from "react";
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
  setActions: (next: SetStateAction<ActionRequiredEvent[]>) => void;
}

export function useActionRequiredController({
  getThreadEvents,
  getActions,
  setActions,
}: ActionRequiredControllerOptions): ActionRequiredController {
  const resolversRef = useRef(new Map<string, (resolution: ActionRequiredResolution) => void>());

  const request = useCallback((input: ActionRequiredRequestInput) => {
    const action = createActionRequiredEvent(input);
    setActions((prev) => new RuntimeLedger({
      threadEvents: getThreadEvents(),
      actionRequired: prev.filter((item) => item.id !== action.id),
    }).appendActionRequired(action).actionRequired);

    return new Promise<ActionRequiredResolution>((resolve) => {
      resolversRef.current.set(action.id, resolve);
    });
  }, [getThreadEvents, setActions]);

  const resolve = useCallback((id: string, resolution: ActionResolution): ActionRequiredResolution => {
    const current = getActions().find((action) => action.id === id);
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
    const liveResolver = resolversRef.current.get(id);
    const result = {
      ...actionRequiredResolution(resolved),
      hadLiveResolver: Boolean(liveResolver),
    };
    setActions((prev) => new RuntimeLedger({
      threadEvents: getThreadEvents(),
      actionRequired: prev,
    }).updateActionRequired(id, resolved).actionRequired);

    if (liveResolver) {
      liveResolver(result);
      resolversRef.current.delete(id);
    }
    return result;
  }, [getActions, getThreadEvents, setActions]);

  const cancel = useCallback((id: string, reason = "User cancelled this action.") => {
    return resolve(id, { status: "cancelled", reason });
  }, [resolve]);

  const expire = useCallback((now?: string) => {
    const next = new RuntimeLedger({
      threadEvents: getThreadEvents(),
      actionRequired: getActions(),
    }).expireActionRequired(now).actionRequired;
    setActions(next);
    return next;
  }, [getActions, getThreadEvents, setActions]);

  const replayPending = useCallback(() => new RuntimeLedger({
    threadEvents: getThreadEvents(),
    actionRequired: getActions(),
  }).replayPending(), [getActions, getThreadEvents]);

  return {
    request,
    resolve,
    cancel,
    expire,
    replayPending,
  };
}
