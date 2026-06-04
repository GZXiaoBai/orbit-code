import type { ActionRequiredEvent } from "./actionRequired";
import type { RuntimeMessage } from "./runtimeMessages";
import type { TerminalRun } from "./terminalRun";
import type { ThreadEvent } from "./threadEvents";
import type { RunStep } from "./runSteps";

export type CodexRuntimeStatus = "stopped" | "starting" | "ready" | "running" | "error";
export type RuntimeRoute = "direct-deepseek-plan" | "codex-app-server-build";
export type RuntimeOperationKind = "plan" | "build" | "restart" | "interrupt";
export type RuntimeOperationStatus = "starting" | "running" | "completed" | "failed" | "cancelled";

export interface RuntimeOperation {
  id: string;
  connectionId?: string;
  kind: RuntimeOperationKind;
  status: RuntimeOperationStatus;
  threadId?: string;
  turnId?: string;
  startedAt: string;
  deadlineAt: string;
  lastEventAt?: string;
  cancelled?: boolean;
  finalState?: "completed" | "failed" | "cancelled";
  error?: string;
}

export interface RuntimeEvent {
  operationId?: string;
  connectionId?: string;
  type: "started" | "item" | "turn" | "status" | "failed" | "cancelled" | "completed";
  item?: CodexItemEvent | CodexItem;
  turn?: CodexTurn;
  status?: CodexRuntimeStatus;
  error?: string;
}

export type CodexItemKind =
  | "user"
  | "assistant"
  | "reasoning"
  | "planDraft"
  | "command"
  | "fileEdit"
  | "approval"
  | "question"
  | "terminal"
  | "usage"
  | "error";

export interface CodexThread {
  id: string;
  title: string;
  workspacePath?: string;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CodexTurn {
  id: string;
  threadId: string;
  status: "running" | "completed" | "failed" | "interrupted";
  mode: "plan" | "build";
  startedAt: string;
  completedAt?: string;
  operationId?: string;
  connectionId?: string;
}

export interface CodexItem {
  id: string;
  threadId: string;
  turnId?: string;
  kind: CodexItemKind;
  title: string;
  text: string;
  status: "pending" | "running" | "completed" | "failed" | "denied";
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export type CodexItemEventType = "upsert" | "delta" | "complete" | "fail";

export interface CodexItemEvent {
  type: CodexItemEventType;
  item?: CodexItem;
  itemId?: string;
  threadId?: string;
  turnId?: string;
  kind?: CodexItemKind;
  title?: string;
  textDelta?: string;
  sequence?: number;
  status?: CodexItem["status"];
  metadata?: Record<string, unknown>;
  error?: string;
  createdAt?: string;
  operationId?: string;
  connectionId?: string;
}

export interface CodexRuntimeProjection {
  status: CodexRuntimeStatus;
  thread: CodexThread | null;
  activeTurn: CodexTurn | null;
  activeOperation?: RuntimeOperation | null;
  items: CodexItem[];
  threadModel: CodexThreadViewModel;
  inspectorModel: CodexInspectorModel;
  events: ThreadEvent[];
  runtimeMessages: RuntimeMessage[];
  actions: ActionRequiredEvent[];
  terminalRuns: TerminalRun[];
  runSteps: RunStep[];
  error?: string;
}

export type CodexInspectorSection = "actions" | "edits" | "terminal" | "reasoning" | "errors" | "usage";

export interface CodexUsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CodexInspectableItem {
  id: string;
  kind: CodexItemKind;
  title: string;
  text: string;
  status: CodexItem["status"];
  threadId: string;
  turnId?: string;
  createdAt: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
}

export interface CodexThreadViewModel {
  status: CodexRuntimeStatus;
  thread: CodexThread | null;
  activeTurn: CodexTurn | null;
  activeOperation?: RuntimeOperation | null;
  messages: CodexInspectableItem[];
  planDrafts: CodexInspectableItem[];
  pendingActions: CodexInspectableItem[];
  running: boolean;
  failed: boolean;
  interrupted: boolean;
  error?: string;
  itemCount: number;
}

export interface CodexInspectorModel {
  items: CodexInspectableItem[];
  actions: CodexInspectableItem[];
  approvals: CodexInspectableItem[];
  questions: CodexInspectableItem[];
  edits: CodexInspectableItem[];
  terminals: CodexInspectableItem[];
  reasoning: CodexInspectableItem[];
  errors: CodexInspectableItem[];
  usageItems: CodexInspectableItem[];
  patchEvents: ThreadEvent[];
  terminalRuns: TerminalRun[];
  usage: CodexUsageSummary;
  counts: {
    actions: number;
    pendingActions: number;
    edits: number;
    terminal: number;
    errors: number;
    changes: number;
  };
}

export interface CodexSidecarStatus {
  running: boolean;
  pid?: number;
  bridgeBaseUrl?: string;
  codexHome?: string;
  lastError?: string;
  lastStderrTail?: string;
  lastExitCode?: number;
}

export interface CodexSidecarVersionInfo {
  version?: string;
  path?: string;
  sha256?: string;
  source: string;
}

export interface RuntimeRestartResult {
  status: CodexSidecarStatus;
  pid?: number;
  error?: string;
}

export interface CodexBridgeProvider {
  id: string;
  label: string;
  baseUrl?: string;
  supported: boolean;
  blockedReason?: string;
}

export interface ProviderBuildGate {
  providerId: string;
  model: string;
  canBuild: boolean;
  canStream: boolean;
  bridgeStatus: "blocked" | "discovery" | "ready" | "smokeFailed" | "vaultLocked";
  blockedReason?: string;
}

export interface ProviderBridgeStatus {
  providerId: string;
  model?: string;
  modelDiscovery: "notConfigured" | "ready" | "failed";
  bridgeSmoke: "notRun" | "passed" | "failed";
  buildEnabled: boolean;
  blockedReason?: string;
}

export interface BridgeSmokeResult {
  providerId: string;
  model?: string;
  status: "passed" | "failed";
  checkedAt: string;
  evidencePath?: string;
  message?: string;
}

export interface CodexRuntimeSettingsModel {
  sidecarStatus: CodexSidecarStatus;
  sidecarInfo?: CodexSidecarVersionInfo;
  sidecarPath?: string;
  bridgeStatus: "stopped" | "starting" | "ready" | "error";
  bridgeBaseUrl?: string;
  activeProvider?: string;
  lastError?: string;
  latestDesktopBuildSmoke?: DesktopBuildSmokeResult;
  diagnostics?: CodexRuntimeDiagnostics;
}

export interface CodexRuntimeDiagnostics {
  pid?: number;
  sidecarPath?: string;
  stderrTail?: string;
  exitCode?: number;
  pendingResponseCount: number;
  pendingRequestCount: number;
  activeOperation?: RuntimeOperation;
  lastEventAt?: string;
  staleEventCount?: number;
  lastStage?: string;
  lastStageAt?: string;
  lastStageMetadata?: unknown;
  stageHistory?: unknown[];
  lastError?: string;
}

export interface FreezeDiagnosticReport {
  generatedAt: string;
  status: CodexRuntimeStatus;
  composerLocked: boolean;
  composerLockReason?: string;
  activeTurn?: CodexTurn | null;
  activeOperation?: RuntimeOperation | null;
  runtimeDiagnostics?: CodexRuntimeDiagnostics;
  itemCount: number;
  runningItemCount: number;
  pendingActionCount: number;
  localStorageSession?: {
    hasThread: boolean;
    activeTurnStatus?: string;
    itemCount: number;
  };
}

export interface DesktopBuildSmokeResult {
  id: string;
  scope: string;
  startedAt: string;
  completedAt: string;
  result: "verified" | "blocked" | "broken";
  liveBuildEnabled: boolean;
  denyApproval: boolean;
  smokeFile: string;
  path?: string;
  appDataOverride?: { enabled: boolean; path?: string };
  criteria: Array<{
    id: string;
    label: string;
    status: "verified" | "blocked" | "broken";
    message: string;
    evidence?: Record<string, unknown>;
  }>;
}
