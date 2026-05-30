import { describe, expect, it, vi } from "vitest";
import { ActionRequiredControllerCore } from "../state/actionRequiredController";
import type { ActionRequiredEvent } from "../domain/actionRequired";

describe("ActionRequiredControllerCore", () => {
  it("requests and resolves durable actions without React state", async () => {
    let actions: ActionRequiredEvent[] = [];
    const controller = new ActionRequiredControllerCore({
      getThreadEvents: () => [],
      getActions: () => actions,
      appendAction: (action) => { actions = [action, ...actions]; },
      updateAction: (id, action) => {
        actions = actions.map((item) => item.id === id ? action : item);
      },
      setActions: (next) => { actions = next; },
    });

    const pending = controller.request({
      id: "approval-1",
      kind: "command",
      title: "Run command",
      description: "npm test",
    });
    expect(actions[0]).toMatchObject({
      id: "approval-1",
      status: "pending",
      resumeAction: { type: "approval", payloadId: "approval-1" },
    });

    const resolved = controller.resolve("approval-1", { approved: true });
    await expect(pending).resolves.toMatchObject({ status: "approved", hadLiveResolver: true });
    expect(resolved).toMatchObject({ status: "approved", hadLiveResolver: true });
    expect(actions[0]).toMatchObject({ status: "approved" });
  });

  it("expires pending actions through the core controller", () => {
    let actions: ActionRequiredEvent[] = [];
    const setActions = vi.fn((next: ActionRequiredEvent[]) => { actions = next; });
    const controller = new ActionRequiredControllerCore({
      getThreadEvents: () => [],
      getActions: () => actions,
      appendAction: (action) => { actions = [action]; },
      updateAction: () => {},
      setActions,
    });

    void controller.request({
      id: "question-1",
      kind: "question",
      title: "Question",
      description: "Pick",
      question: "Pick",
      expiresAt: "2026-05-29T00:00:00.000Z",
    });
    const expired = controller.expire("2026-05-29T00:00:01.000Z");

    expect(setActions).toHaveBeenCalled();
    expect(expired[0]).toMatchObject({ id: "question-1", status: "expired" });
  });
});
