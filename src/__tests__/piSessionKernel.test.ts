import { describe, expect, it } from "vitest";
import { PiSessionKernel } from "../state/piSessionKernel";

describe("PiSessionKernel", () => {
  it("creates a Pi-style clean session runtime with no inherited entries", () => {
    const kernel = new PiSessionKernel();
    const created = kernel.createSession("/repo", "New thread", "2026-05-30T00:00:00.000Z");

    expect(created.thread).toMatchObject({
      workspacePath: "/repo",
      title: "New thread",
      updatedAt: "2026-05-30T00:00:00.000Z",
    });
    expect(created.entries).toEqual([]);
    expect(created.cleanRuntime.runtimeLedgerSnapshot).toMatchObject({
      threadEvents: [],
      actionRequired: [],
      toolCalls: [],
      terminalRuns: [],
    });
  });

  it("renames, archives, deletes, and forks session state through the kernel", () => {
    const kernel = new PiSessionKernel();
    const created = kernel.createSession("/repo", "Original", "2026-05-30T00:00:00.000Z");
    const renamed = kernel.renameSession({ [created.thread.threadId]: created.thread }, created.thread.threadId, "Renamed");
    const archived = kernel.archiveSession(renamed, created.thread.threadId);
    const deleted = kernel.deleteSession(archived, { [created.thread.threadId]: { value: true } }, created.thread.threadId);

    expect(renamed[created.thread.threadId].title).toBe("Renamed");
    expect(archived[created.thread.threadId].archived).toBe(true);
    expect(deleted.threads[created.thread.threadId]).toBeUndefined();

    const forked = kernel.forkSession({
      source: {
        ...created,
        entries: [
          { id: "e1", parentId: null, threadId: created.thread.threadId, kind: "message", payload: "one", createdAt: "t1" },
          { id: "e2", parentId: "e1", threadId: created.thread.threadId, kind: "message", payload: "two", createdAt: "t2" },
        ],
      },
      entryId: "e1",
      threadId: "fork-thread",
    });

    expect(forked.thread.threadId).toBe("fork-thread");
    expect(forked.entries).toHaveLength(1);
    expect(forked.entries[0]).toMatchObject({ id: "e1", threadId: "fork-thread" });
  });
});
