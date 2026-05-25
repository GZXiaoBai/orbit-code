import { describe, expect, it } from "vitest";
import { applyProjectUiState, upsertProjectUiState } from "../state/projectUiState";
import type { WorkspaceProject } from "../state/useProjectStore";

const projects: WorkspaceProject[] = [
  { id: "a", name: "A", workspacePath: "/tmp/a", lastOpenedAt: "2026-05-24T00:00:00.000Z" },
  { id: "b", name: "B", workspacePath: "/tmp/b", lastOpenedAt: "2026-05-25T00:00:00.000Z" },
];

describe("project UI state", () => {
  it("pins projects ahead of recency and applies display names", () => {
    const state = upsertProjectUiState({}, "/tmp/a", { pinned: true, displayName: "Alpha" });
    const result = applyProjectUiState(projects, state);

    expect(result.map((project) => project.workspacePath)).toEqual(["/tmp/a", "/tmp/b"]);
    expect(result[0].name).toBe("Alpha");
  });

  it("archives projects without deleting the source record", () => {
    const state = upsertProjectUiState({}, "/tmp/b", { archived: true });

    expect(applyProjectUiState(projects, state).map((project) => project.workspacePath)).toEqual(["/tmp/a"]);
    expect(state["/tmp/b"].archived).toBe(true);
  });
});
