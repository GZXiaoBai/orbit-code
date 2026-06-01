import type { CodexThreadViewModel } from "../../domain/codex";

export interface ThreadScrollMetrics {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

export function distanceFromThreadBottom(metrics: ThreadScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight);
}

export function shouldFollowThreadScroll(metrics: ThreadScrollMetrics, threshold = 180): boolean {
  return distanceFromThreadBottom(metrics) < threshold;
}

export function buildThreadScrollSignal(model: CodexThreadViewModel): string {
  const messageSignal = model.messages
    .map((item) => `${item.id}:${item.status}:${item.text.length}`)
    .join("|");
  const actionSignal = model.pendingActions
    .map((item) => `${item.id}:${item.status}`)
    .join("|");
  const planSignal = model.planDrafts
    .map((item) => `${item.id}:${item.status}:${item.text.length}`)
    .join("|");
  return [
    model.itemCount,
    model.running ? "running" : "idle",
    model.failed ? "failed" : "ok",
    model.interrupted ? "interrupted" : "continuous",
    model.error || "",
    messageSignal,
    actionSignal,
    planSignal,
  ].join("::");
}
