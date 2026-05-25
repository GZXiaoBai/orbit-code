import type { AgentSettings, ContextCompactionState } from "./types";

export interface CompactionMessage {
  role: "user" | "assistant";
  content: string;
}

export function contextBudgetTriggerRatio(budget: AgentSettings["contextBudget"]): number {
  if (budget === "compact") return 0.55;
  if (budget === "large") return 0.82;
  return 0.70;
}

export function estimateTokensFromText(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateConversationTokens(messages: CompactionMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateTokensFromText(message.content), 0);
}

export function shouldCompactContext(input: {
  settings: AgentSettings;
  maxContextTokens: number;
  messages: CompactionMessage[];
  iteration: number;
}): { shouldCompact: boolean; state: ContextCompactionState } {
  const triggerRatio = contextBudgetTriggerRatio(input.settings.contextBudget);
  const sourceTokenEstimate = estimateConversationTokens(input.messages);
  return {
    shouldCompact: Boolean(input.settings.autoCompact)
      && input.iteration > 2
      && sourceTokenEstimate >= Math.floor(input.maxContextTokens * triggerRatio),
    state: {
      enabled: Boolean(input.settings.autoCompact),
      triggerRatio,
      sourceTokenEstimate,
    },
  };
}

export function buildDeterministicContextSummary(messages: CompactionMessage[]): string {
  const preserved = messages.slice(-6);
  const bullets = preserved
    .map((message) => {
      const compact = message.content.replace(/\s+/g, " ").trim().slice(0, 420);
      return `- ${message.role}: ${compact}`;
    })
    .join("\n");

  return [
    "Context was automatically compressed.",
    "Preserved recent goals, tool results, pending approvals, patch proposals, and user constraints from the latest interaction window.",
    bullets,
  ].filter(Boolean).join("\n");
}
