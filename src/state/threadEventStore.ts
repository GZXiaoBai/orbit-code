import type { AgentEvent } from "../domain/agentEvents";
import type { ThreadEvent } from "../domain/threadEvents";
import {
  agentEventToThreadEvent,
  buildAgentEventsFromThreadEvents,
  normalizeStoredThreadEvents,
  serializeThreadEvents,
} from "../domain/threadEvents";

export type ThreadEventUpdater = ThreadEvent[] | ((events: ThreadEvent[]) => ThreadEvent[]);
export type LegacyAgentEventUpdater = AgentEvent[] | ((events: AgentEvent[]) => AgentEvent[]);

export function restoreThreadEventStore(input: {
  threadEvents?: ThreadEvent[] | null;
  agentEvents?: AgentEvent[] | null;
}): ThreadEvent[] {
  return serializeThreadEvents(normalizeStoredThreadEvents(input));
}

export function restoreLegacySnapshot(agentEvents?: AgentEvent[] | null): ThreadEvent[] {
  return serializeThreadEvents(normalizeStoredThreadEvents({ agentEvents }));
}

export function serializeRuntimeThreadEvents(events: ThreadEvent[]): ThreadEvent[] {
  return serializeThreadEvents(events);
}

export function applyThreadEventUpdate(current: ThreadEvent[], update: ThreadEventUpdater): ThreadEvent[] {
  const next = typeof update === "function" ? update(current) : update;
  return serializeThreadEvents(next);
}

export function applyLegacyAgentEventUpdate(current: ThreadEvent[], update: LegacyAgentEventUpdater): ThreadEvent[] {
  const legacy = buildAgentEventsFromThreadEvents(current);
  const nextLegacy = typeof update === "function" ? update(legacy) : update;
  const existingById = new Map(current.map((event) => [event.id, event]));
  return serializeThreadEvents(
    nextLegacy.map((event) => {
      const migrated = agentEventToThreadEvent(event);
      const existing = existingById.get(event.id);
      if (!existing) return migrated;
      return {
        ...migrated,
        kind: existing.kind,
        sourceEvent: existing.sourceEvent,
      };
    }),
  );
}

export function appendThreadEvent(current: ThreadEvent[], event: ThreadEvent | AgentEvent): ThreadEvent[] {
  const threadEvent = "kind" in event ? event : agentEventToThreadEvent(event);
  return serializeThreadEvents([...current, threadEvent]);
}

export function updateThreadEventById(
  current: ThreadEvent[],
  id: string,
  update: Partial<ThreadEvent> | ((event: ThreadEvent) => ThreadEvent),
): ThreadEvent[] {
  return serializeThreadEvents(current.map((event) => {
    if (event.id !== id) return event;
    return typeof update === "function" ? update(event) : { ...event, ...update };
  }));
}

export function threadEventsToLegacyAgentEvents(events: ThreadEvent[]): AgentEvent[] {
  return buildAgentEventsFromThreadEvents(events);
}
