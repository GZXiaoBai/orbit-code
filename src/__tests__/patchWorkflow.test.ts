import { describe, expect, it } from "vitest";
import { markEventPatchesApplied, normalizePatchProposal, replaceEventPatches, type PatchEventLike } from "../state/patchWorkflow";

describe("patch workflow", () => {
  it("normalizes structured patch proposals", () => {
    const patches = normalizePatchProposal({
      patches: [
        { path: "src/App.tsx", oldContent: "old", newContent: "new" },
        { path: "", oldContent: "x", newContent: "y" },
      ],
    });

    expect(patches).toEqual([
      { path: "src/App.tsx", oldContent: "old", newContent: "new", applied: false, sandboxStatus: "idle", applyStatus: "proposed" },
    ]);
  });

  it("normalizes legacy path/content proposals", () => {
    const patches = normalizePatchProposal({ path: "README.md", content: "hello" });

    expect(patches).toEqual([
      { path: "README.md", oldContent: "", newContent: "hello", applied: false, sandboxStatus: "idle", applyStatus: "proposed" },
    ]);
  });

  it("marks only selected event patches applied", () => {
    const events: PatchEventLike[] = [
      { id: "a", patches: [{ path: "a.ts", oldContent: "", newContent: "a", applied: false }] },
      { id: "b", patches: [{ path: "b.ts", oldContent: "", newContent: "b", applied: false }] },
    ];

    const next = markEventPatchesApplied(events, "b", events[1].patches!);

    expect(next[0].patches?.[0].applied).toBe(false);
    expect(next[1].patches?.[0].applied).toBe(true);
    expect(next[1].patches?.[0].applyStatus).toBe("applied");
  });

  it("replaces event patches without touching other events", () => {
    const events: PatchEventLike[] = [
      { id: "a", patches: [{ path: "a.ts", oldContent: "", newContent: "a", applied: false }] },
      { id: "b", patches: [{ path: "b.ts", oldContent: "", newContent: "b", applied: false }] },
    ];

    const next = replaceEventPatches(events, "a", [
      { path: "c.ts", oldContent: "", newContent: "c", applied: false },
    ]);

    expect(next[0].patches?.[0].path).toBe("c.ts");
    expect(next[1].patches?.[0].path).toBe("b.ts");
  });
});
