import type { ThreadEvent } from "../domain/threadEvents";
import { createThreadEvent } from "../domain/threadEvents";

export type ThreadEventUpdater = ThreadEvent[] | ((events: ThreadEvent[]) => ThreadEvent[]);

export function restoreThreadEventStore(snapshot?: { threadEvents?: ThreadEvent[] | null }): ThreadEvent[] {
  return snapshot?.threadEvents || [];
}

export function applyThreadEventUpdate(current: ThreadEvent[], update: ThreadEventUpdater): ThreadEvent[] {
  return typeof update === "function" ? update(current) : update;
}

export function appendThreadEvent(current: ThreadEvent[], event: ThreadEvent): ThreadEvent[] {
  return [...current, event];
}

export function updateThreadEventById(
  current: ThreadEvent[],
  id: string,
  patch: Partial<ThreadEvent> | ((event: ThreadEvent) => ThreadEvent),
): ThreadEvent[] {
  return current.map((event) => {
    if (event.id !== id) return event;
    return typeof patch === "function" ? patch(event) : { ...event, ...patch };
  });
}

export function createStoreEvent(input: Parameters<typeof createThreadEvent>[0]): ThreadEvent {
  return createThreadEvent(input);
}
