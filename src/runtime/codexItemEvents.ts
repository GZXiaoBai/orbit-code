import type { CodexItem, CodexItemEvent } from "../domain/codex";

function isCodexItem(value: CodexItemEvent | CodexItem): value is CodexItem {
  return "id" in value && "kind" in value && "text" in value && !("type" in value);
}

function sequenceKey(itemId: string) {
  return `__deltaSequences:${itemId}`;
}

function itemWithSequence(item: CodexItem, sequence?: number): CodexItem {
  if (sequence === undefined) return item;
  const metadata = { ...(item.metadata || {}) };
  metadata[sequenceKey(item.id)] = sequence;
  return { ...item, metadata };
}

function hasSeenSequence(item: CodexItem | undefined, sequence: number | undefined): boolean {
  if (!item || sequence === undefined) return false;
  const lastSequence = item.metadata?.[sequenceKey(item.id)];
  return typeof lastSequence === "number" && sequence <= lastSequence;
}

function mergeText(existing: string, incoming: string | undefined): string {
  if (!incoming) return existing;
  if (existing && existing.startsWith(incoming) && incoming.length < existing.length) {
    return existing;
  }
  return incoming;
}

function mergeItem(items: CodexItem[], next: CodexItem): CodexItem[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index === -1) return [...items, next];
  return items.map((item, itemIndex) => itemIndex === index ? {
    ...item,
    ...next,
    text: mergeText(item.text, next.text),
    metadata: { ...(item.metadata || {}), ...(next.metadata || {}) },
  } : item);
}

export function applyCodexItemEvent(items: CodexItem[], event: CodexItemEvent | CodexItem): CodexItem[] {
  if (isCodexItem(event)) return mergeItem(items, event);
  if (event.type === "upsert" && event.item) return mergeItem(items, event.item);

  const itemId = event.itemId || event.item?.id;
  if (!itemId) return items;
  const index = items.findIndex((item) => item.id === itemId);
  const existing = index >= 0 ? items[index] : undefined;
  if (event.type === "delta" && hasSeenSequence(existing, event.sequence)) return items;

  const base: CodexItem = existing || {
    id: itemId,
    threadId: event.threadId || "unknown",
    turnId: event.turnId,
    kind: event.kind || "assistant",
    title: event.title || "Codex",
    text: "",
    status: "running",
    createdAt: event.createdAt || new Date().toISOString(),
    metadata: event.metadata,
  };

  const patched: CodexItem = itemWithSequence({
    ...base,
    threadId: event.threadId || base.threadId,
    turnId: event.turnId || base.turnId,
    kind: event.kind || base.kind,
    title: event.title || event.item?.title || base.title,
    text: event.type === "delta" ? `${base.text}${event.textDelta || ""}` : mergeText(base.text, event.item?.text),
    status: event.type === "fail" ? "failed" : event.status || (event.type === "complete" ? "completed" : base.status),
    metadata: {
      ...(base.metadata || {}),
      ...(event.item?.metadata || {}),
      ...(event.metadata || {}),
      ...(event.error ? { error: event.error } : {}),
    },
  }, event.sequence);

  if (index === -1) return [...items, patched];
  return items.map((item, itemIndex) => itemIndex === index ? patched : item);
}

export function applyCodexItemEvents(items: CodexItem[], events: Array<CodexItemEvent | CodexItem>): CodexItem[] {
  return events.reduce(applyCodexItemEvent, items);
}
