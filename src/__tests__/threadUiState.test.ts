import { describe, expect, it } from "vitest";
import { getThreadUiState, threadIdFor, upsertThreadUiState } from "../state/threadUiState";

describe("thread UI state", () => {
  it("builds a stable thread id from the workspace path", () => {
    expect(threadIdFor("/tmp/project", "Fallback")).toBe("/tmp/project");
    expect(threadIdFor("", "Plan")).toBe("Plan");
  });

  it("renames, pins, and archives a thread", () => {
    let state = upsertThreadUiState({}, "/tmp/project", { workspacePath: "/tmp/project", title: "New title" });
    state = upsertThreadUiState(state, "/tmp/project", { pinned: true });
    state = upsertThreadUiState(state, "/tmp/project", { archived: true });

    expect(getThreadUiState(state, "/tmp/project")).toMatchObject({
      title: "New title",
      pinned: true,
      archived: true,
    });
  });
});
