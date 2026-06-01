import type { ToolParams } from "../domain/runtimePrimitives";
import type { ThreadPatch } from "../domain/threadEvents";

export type PatchItem = ThreadPatch;

export interface PatchEventLike {
  id: string;
  patches?: PatchItem[];
}

function normalizePatchObject(value: unknown): PatchItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const path = typeof item.path === "string" ? item.path.trim() : "";
  const oldContent = typeof item.oldContent === "string" ? item.oldContent : "";
  const newContent = typeof item.newContent === "string" ? item.newContent : "";
  if (!path || newContent === "") return null;
  return { path, oldContent, newContent, applied: false, sandboxStatus: "idle", applyStatus: "proposed" };
}

export function normalizePatchProposal(params: ToolParams): PatchItem[] {
  const patches = Array.isArray(params.patches)
    ? params.patches.map(normalizePatchObject).filter((patch): patch is PatchItem => Boolean(patch))
    : [];

  if (patches.length > 0) return patches;

  const legacyPatch = normalizePatchObject({
    path: params.path,
    oldContent: params.oldContent,
    newContent: params.newContent ?? params.content,
  });

  return legacyPatch ? [legacyPatch] : [];
}

export function markEventPatchesApplied<T extends PatchEventLike>(events: T[], eventId: string, appliedPatches: PatchItem[]): T[] {
  return events.map((event) => {
    if (event.id !== eventId || !event.patches) return event;
    return {
      ...event,
      patches: appliedPatches.map((patch) => ({ ...patch, applied: true, applyStatus: "applied" })),
    };
  });
}

export function replaceEventPatches<T extends PatchEventLike>(events: T[], eventId: string, patches: PatchItem[]): T[] {
  return events.map((event) => event.id === eventId ? { ...event, patches } : event);
}
