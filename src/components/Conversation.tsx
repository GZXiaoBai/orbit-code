import { MoreHorizontal } from "lucide-react";
import type { AppCopy } from "../i18n/copy";
import type { ImportedPlanState, ImportErrorState, AgentEvent } from "../state/useWorkspace";
import type { AgentLoopPhase, ToolCall } from "../domain/agentLoop";
import { Composer } from "./Composer";
import { AgentTimeline } from "./thread/AgentTimeline";
import { CommandApprovalCard } from "./thread/CommandApprovalCard";
import { EmptyThreadState } from "./thread/EmptyThreadState";
import { PlanSummary } from "./thread/PlanSummary";

interface ConversationProps {
  copy: AppCopy;
  importedPlan: ImportedPlanState | null;
  importError: ImportErrorState | null;
  onPlanImport: (source: string, fileName?: string) => Promise<boolean> | boolean;
  terminalLogs: Record<string, string>;
  commandStatus: Record<string, { running: boolean; exitCode: number | null }>;
  onExecuteCommand?: (taskId: string, command: string) => void;
  agentEvents?: AgentEvent[];
  onApplyEventPatch?: (eventId: string) => Promise<void>;
  onRestartCollaboration?: () => void;
  onRefinePatch?: (eventId: string, feedback: string) => Promise<void> | void;
  onUpdatePatch?: (eventId: string, path: string, updates: Partial<any>) => void;
  agentLoopPhase?: AgentLoopPhase;
  agentLoopRunning?: boolean;
  agentLoopToolCalls?: ToolCall[];
  onStartAgentLoop?: () => void;
  onCancelAgentLoop?: () => void;
  streamingContent?: string;
  streamingActive?: boolean;
}

export function Conversation({
  copy,
  importedPlan,
  importError,
  onPlanImport,
  terminalLogs,
  commandStatus,
  onExecuteCommand,
  agentEvents = [],
  onApplyEventPatch,
  onRestartCollaboration,
  onRefinePatch,
  onUpdatePatch,
  agentLoopPhase,
  agentLoopRunning,
  agentLoopToolCalls,
  onStartAgentLoop,
  onCancelAgentLoop,
  streamingContent,
  streamingActive,
}: ConversationProps) {
  const plan = importedPlan?.plan;
  const title = plan?.title ?? copy.title;
  const pendingTask = plan?.tasks.find((t) => t.status !== "done" && t.status !== "verified");

  return (
    <section className="conversation-shell">
      <header className="thread-title">
        <h1>{title}</h1>
        <button aria-label="More options">
          <MoreHorizontal size={20} />
        </button>
      </header>

      <div className="conversation-scroll">
        <article className="assistant-message">
          <div className="workspace-summary">
            {copy.workspaceSummary.map(([label, value]) => (
              <section key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </section>
            ))}
          </div>

          {plan ? <p>{copy.assistant.intro}</p> : null}

          <PlanSummary copy={copy} importedPlan={importedPlan} importError={importError} />

          <AgentTimeline
            copy={copy}
            agentEvents={agentEvents}
            agentLoopPhase={agentLoopPhase}
            agentLoopRunning={agentLoopRunning}
            agentLoopToolCalls={agentLoopToolCalls}
            onStartAgentLoop={onStartAgentLoop}
            onCancelAgentLoop={onCancelAgentLoop}
            onRestartCollaboration={onRestartCollaboration}
            onApplyEventPatch={onApplyEventPatch}
            onRefinePatch={onRefinePatch}
            onUpdatePatch={onUpdatePatch}
            streamingContent={streamingContent}
            streamingActive={streamingActive}
          />

          {pendingTask ? (
            <CommandApprovalCard
              copy={copy}
              pendingTask={pendingTask}
              terminalLogs={terminalLogs}
              commandStatus={commandStatus}
              onExecuteCommand={onExecuteCommand}
            />
          ) : null}

          {!plan && agentEvents.length === 0 ? <EmptyThreadState copy={copy} /> : null}
        </article>
      </div>

      <Composer
        copy={copy}
        onPlanImport={onPlanImport}
      />
    </section>
  );
}
