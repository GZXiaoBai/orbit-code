export type Language = "zh" | "en";

export type Theme = "light" | "dark";

export type AgentRole = "planner" | "coder" | "reviewer" | "verifier";

export type WorkbenchMode = "plan" | "build";

export type ReasoningEffort = "auto" | "fast" | "balanced" | "deep" | "high" | "max";

export type PermissionPreset = "readOnly" | "askBeforeAction" | "fullAccess";

export type PermissionAction =
  | "read"
  | "search"
  | "command"
  | "write"
  | "network"
  | "install"
  | "secrets";

export type PermissionDecision = "allow" | "ask" | "deny";

export type SandboxMode = "none" | "restricted" | "docker";

export interface SecuritySettings {
  preset: PermissionPreset;
  advancedRules: Partial<Record<PermissionAction, PermissionDecision>>;
  sandboxMode: SandboxMode;
}

export interface ProjectSecurityOverride {
  workspacePath: string;
  preset?: PermissionPreset;
  advancedRules?: Partial<Record<PermissionAction, PermissionDecision>>;
  updatedAt: string;
}

export interface AgentSettings {
  maxIterations: number;
  contextBudget: "compact" | "balanced" | "large";
  autoCompact: boolean;
  autoSelfHeal: boolean;
  verificationApproval: boolean;
  fixtureProviderEnabled: boolean;
}

export interface ContextCompactionState {
  enabled: boolean;
  triggerRatio: number;
  lastSummary?: string;
  compactedAtIteration?: number;
  sourceTokenEstimate: number;
}

export interface GeneralSettings {
  startMode: WorkbenchMode;
  openLastWorkspace: boolean;
}

export type ContextRuleMode = "plan" | "build" | "both";
export type ContextRuleSource = "user" | "workspace" | "project";

export interface ContextRule {
  id: string;
  title: string;
  content: string;
  enabled: boolean;
  mode: ContextRuleMode;
  source: ContextRuleSource;
  globs?: string[];
  regex?: string[];
  policy?: "on" | "off" | "always";
}

export interface ContextSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  modeSlugs?: ContextRuleMode[];
  source: "project";
  path: string;
}

export interface ContextSettings {
  userRules: ContextRule[];
}

export interface AdvancedSettings {
  diagnosticsEnabled: boolean;
}

export type DensityMode = "comfortable" | "compact";
export type ThinkingDisplayPreference = "expanded" | "collapsed" | "hidden";

export interface LayoutPreferences {
  reviewDockVisible: boolean;
  density: DensityMode;
  settingsSection: string;
  composerPinned: boolean;
  showAgentReasoning: boolean;
  thinkingDisplayPreference: ThinkingDisplayPreference;
  projectRailWidth?: number;
  reviewDockWidth?: number;
}

export interface ProjectMenuState {
  workspacePath: string;
  x?: number;
  y?: number;
  openedBy: "button" | "context";
}

export interface ThreadMenuState {
  open: boolean;
}

export interface ThreadUiState {
  threadId: string;
  workspacePath?: string;
  title?: string;
  pinned?: boolean;
  archived?: boolean;
  updatedAt: string;
}

export interface ProjectUiState {
  workspacePath: string;
  displayName?: string;
  pinned?: boolean;
  archived?: boolean;
  lastOpenedAt?: string;
}

export interface FileTreeUiState {
  workspacePath: string;
  expandedDirs: string[];
  selectedFilePath?: string;
  recentFiles: string[];
  filter: string;
  updatedAt: string;
}

export interface UsageSnapshot {
  commandRuns: number;
  terminalRuns: number;
  llmTokens?: number;
  lastRunAt?: string;
}

export interface RunModelSelection {
  providerId: string;
  model: string;
  customModel?: string;
  reasoningEffort: ReasoningEffort;
}

export type TaskStatus =
  | "queued"
  | "running"
  | "blocked"
  | "review"
  | "verified"
  | "done";

export type PermissionLevel = "read" | "write" | "shell" | "network" | "secrets";

export type ApprovalMode = "ask" | "allow_once" | "allow_repo" | "deny";

export interface PlanTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  dependsOn: string[];
  agentHint?: AgentRole;
  filesHint: string[];
  verification: string[];
}

export interface PlanDecisionQuestion {
  question: string;
  recommended?: string;
  options: string[];
}

export interface CodingPlan {
  version: "1";
  title: string;
  goals: string[];
  constraints: string[];
  tasks: PlanTask[];
  decisionQuestions?: PlanDecisionQuestion[];
  acceptanceCriteria: string[];
  risks: string[];
  references: string[];
}

export interface AcceptedBuildPlan {
  plan: CodingPlan;
  source: "codex-plan-draft";
  acceptedAt: string;
  title: string;
}

export interface ModelProviderCapability {
  text: boolean;
  vision: boolean;
  toolCalls: boolean;
  jsonSchema: boolean;
  local: boolean;
  streaming: boolean;
  maxContextTokens: number;
}

export interface ModelCapability {
  streaming: boolean;
  reasoningLevels: ReasoningEffort[];
  toolCalls: boolean;
  local: boolean;
  buildSupported: boolean;
  maxContextTokens: number;
  maxOutputTokens?: number;
  capabilitySource: "api" | "officialTable" | "manual";
}

export interface ImportedModelInfo {
  id: string;
  label?: string;
  capability: ModelCapability;
  raw?: unknown;
}

export type ProviderSmokeStatus = "notConfigured" | "imported" | "smokePassed" | "smokeFailed";

export interface ProviderSmokeRecord {
  status: ProviderSmokeStatus;
  message?: string;
  checkedAt?: string;
}

export type PatchSandboxStatus = "idle" | "sandboxing" | "sandboxed" | "failed";

export type PatchApplyStatus = "proposed" | "approved" | "applied" | "failed";

export interface SandboxPreview {
  id: string;
  proposalId: string;
  sandboxPath: string;
  status: PatchSandboxStatus;
  output: string;
  createdAt: string;
}

export interface ModelProviderConfig {
  id: string;
  label: string;
  baseUrl?: string;
  apiKeyName?: string;
  defaultModel: string;
  recommendedModels: string[];
  capabilities: ModelProviderCapability;
}

export interface ProviderPersistenceState {
  providerId: string;
  hasKey: boolean;
  keySource: "orbit-code" | "agent-gui" | "missing";
  settingsSource: "sqlite" | "legacySqlite" | "localStorage" | "missing";
  needsModelRefresh: boolean;
}

export interface ComposerAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: "text" | "code" | "image" | "pdf" | "plan" | "unknown";
  content?: string;
  source: "paste" | "drop" | "file-picker";
}

export interface RuntimeEvent {
  id: string;
  taskId?: string;
  kind: "message" | "tool_call" | "permission" | "patch" | "test";
  title: string;
  summary: string;
  createdAt: string;
}

export interface PermissionRequest {
  id: string;
  command: string;
  cwd: string;
  reason: string;
  levels: PermissionLevel[];
  defaultMode: ApprovalMode;
}
