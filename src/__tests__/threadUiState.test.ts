import { describe, expect, it } from "vitest";
import { getThreadUiState, groupThreadsByWorkspace, listThreadsForWorkspace, threadIdFor, upsertThreadUiState } from "../state/threadUiState";

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

  it("lists active workspace threads before archived threads and other projects", () => {
    const state = {
      first: {
        threadId: "first",
        workspacePath: "/tmp/project",
        title: "Older",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      pinned: {
        threadId: "pinned",
        workspacePath: "/tmp/project",
        title: "Pinned",
        pinned: true,
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      archived: {
        threadId: "archived",
        workspacePath: "/tmp/project",
        archived: true,
        updatedAt: "2027-01-01T00:00:00.000Z",
      },
      other: {
        threadId: "other",
        workspacePath: "/tmp/other",
        updatedAt: "2027-01-01T00:00:00.000Z",
      },
    };

    expect(listThreadsForWorkspace(state, "/tmp/project").map((thread) => thread.threadId)).toEqual(["pinned", "first"]);
  });

  it("groups visible threads by workspace", () => {
    const grouped = groupThreadsByWorkspace({
      a: { threadId: "a", workspacePath: "/tmp/a", updatedAt: "2026-01-01T00:00:00.000Z" },
      b: { threadId: "b", workspacePath: "/tmp/b", updatedAt: "2026-01-01T00:00:00.000Z" },
      archived: { threadId: "archived", workspacePath: "/tmp/a", archived: true, updatedAt: "2026-01-01T00:00:00.000Z" },
    });

    expect(grouped["/tmp/a"].map((thread) => thread.threadId)).toEqual(["a"]);
    expect(grouped["/tmp/b"].map((thread) => thread.threadId)).toEqual(["b"]);
  });
});
