import { useCallback, useMemo, useState } from "react";
import type { CodexSidecarStatus, ProviderBuildGate } from "../domain/codex";
import { parseCodingPlan } from "../domain/planSchema";
import type { ThreadEvent } from "../domain/threadEvents";
import type { PermissionPreset, ProjectSecurityOverride } from "../domain/types";
import { createDeepSeekSmokeRunRecord } from "../runtime/deepSeekSmokeHarness";
import { buildEffectiveSecurityPolicy } from "../runtime/securityPolicy";
import { ContextProviderRegistry, type ContextInspectorModel } from "../runtime/contextProviders";
import { invokeDesktop, isDesktopRuntime } from "../runtime/desktopGateway";
import { buildUsageSnapshot, codexUsageTokenRecords } from "./usageSnapshot";
import { codexComposerSubmitLocked, useCodexSession } from "./useCodexSession";
import { useFileSystem } from "./useFileSystem";
import { useLayoutPreferences } from "./useLayoutPreferences";
import { useProjectActions } from "./useProjectActions";
import { useProjectStore } from "./useProjectStore";
import { useRunControls } from "./useRunControls";
import { useSession, type ImportedPlanState } from "./useSession";
import { useThreadUiState } from "./useThreadUiState";
import { useWindowActions } from "./useWindowActions";

export type { ImportedPlanState, ImportErrorState, ProviderSettings } from "./useSession";

function emptyContextInspector(mode: "plan" | "build" = "plan"): ContextInspectorModel {
  return {
    blocks: [],
    disabledBlocks: [],
    skills: [],
    editableSources: [
      { path: "ORBIT.md", title: "ORBIT.md", source: "workspace", exists: false, content: "" },
      { path: ".orbit/rules", title: ".orbit/rules", source: "project", exists: false, content: "" },
      { path: ".orbit/rules.md", title: ".orbit/rules.md", source: "project", exists: false, content: "" },
    ],
    externalRuleCandidates: [],
    source: "codex-sidecar-context",
    mode,
    tokenEstimate: 0,
    errors: [],
    matchedRules: [],
    permissionImpact: "none",
    lastCollectedAt: "",
  };
}

function noopAsync(..._args: unknown[]) {
  return Promise.resolve();
}

export function buildEffectiveWorkspaceBuildGate(input: {
  gate: ProviderBuildGate;
  providerId: string;
  sidecarStatus: CodexSidecarStatus;
  desktopRuntime: boolean;
}): ProviderBuildGate {
  void input.providerId;
  void input.sidecarStatus;
  void input.desktopRuntime;
  return input.gate;
}

export function useWorkspace() {
  const session = useSession();
  const layout = useLayoutPreferences();
  const projectStore = useProjectStore();
  const projectActions = useProjectActions(projectStore.recentProjects);
  const runControls = useRunControls(session.providerSettings, session.apiKeys, session.credentialVaultProviders);
  const fs = useFileSystem(session.providerSettings, session.updateTask, () => undefined, []);
  const threadUi = useThreadUiState(fs.workspaceRoot, session.importedPlan?.plan.title || "Orbit Codex");
  const windowActions = useWindowActions();
  const codex = useCodexSession();
  const [sessionSearchQuery, setSessionSearchQuery] = useState("");
  const [currentContextInspector, setCurrentContextInspector] = useState<ContextInspectorModel>(() => emptyContextInspector(runControls.mode));
  const [plansByThreadId, setPlansByThreadId] = useState<Record<string, ImportedPlanState | null>>({});
  const effectiveBuildGate = useMemo(() => buildEffectiveWorkspaceBuildGate({
    gate: runControls.buildGate,
    providerId: runControls.selection.providerId,
    sidecarStatus: codex.runtimeSettings.sidecarStatus,
    desktopRuntime: isDesktopRuntime(),
  }), [codex.runtimeSettings.sidecarStatus, runControls.buildGate, runControls.selection.providerId]);
  const effectiveRunControls = useMemo(() => ({
    ...runControls,
    buildSupported: effectiveBuildGate.canBuild,
    buildGate: effectiveBuildGate,
  }), [effectiveBuildGate, runControls]);

  const projectSecurityOverride = fs.workspaceRoot
    ? session.providerSettings.projectSecurityOverrides?.[fs.workspaceRoot]
    : undefined;
  const effectiveSecurityPolicy = buildEffectiveSecurityPolicy(
    session.providerSettings.security,
    projectSecurityOverride,
  );

  const collectRuntimeContext = useCallback(async () => {
    const registry = new ContextProviderRegistry();
    const inspector = await registry.collectInspector({
      mode: runControls.mode,
      workspacePath: fs.workspaceRoot,
      threadId: threadUi.threadId,
      planSnapshot: session.importedPlan?.plan || null,
      userRules: session.providerSettings.context?.userRules || [],
      readWorkspaceFile: (path) => fs.workspaceRoot ? invokeDesktop("read_workspace_file", { path, workspacePath: fs.workspaceRoot }) : Promise.resolve(""),
      listWorkspaceFiles: () => fs.workspaceRoot ? invokeDesktop("list_workspace_files", { workspacePath: fs.workspaceRoot }) : Promise.resolve([]),
    });
    setCurrentContextInspector(inspector);
    return inspector;
  }, [fs.workspaceRoot, runControls.mode, session.importedPlan?.plan, session.providerSettings.context?.userRules, threadUi.threadId]);

  const updateProjectSecurityOverride = useCallback((patch: Partial<ProjectSecurityOverride> & { preset?: PermissionPreset }) => {
    if (!fs.workspaceRoot) return;
    void session.updateProviderSettings({
      ...session.providerSettings,
      projectSecurityOverrides: {
        ...(session.providerSettings.projectSecurityOverrides || {}),
        [fs.workspaceRoot]: {
          workspacePath: fs.workspaceRoot,
          updatedAt: new Date().toISOString(),
          ...projectSecurityOverride,
          ...patch,
        },
      },
    });
  }, [fs.workspaceRoot, projectSecurityOverride, session]);

  const setWorkspaceRoot = useCallback(async (path: string) => {
    const ok = await fs.setWorkspaceRoot(path);
    if (ok) {
      await projectStore.rememberProject(path);
      codex.clear();
    }
    return ok;
  }, [codex, fs, projectStore]);

  const submitToCodex = useCallback(async (prompt: string, mode = runControls.mode) => {
    if (!prompt.trim()) return;
    await codex.submit({
      prompt,
      workspacePath: fs.workspaceRoot,
      mode,
      providerId: runControls.selection.providerId,
      model: runControls.selection.model,
      baseUrl: session.providerSettings.configs[runControls.selection.providerId]?.baseUrl,
      threadId: threadUi.threadId,
      reasoningEffort: runControls.selection.reasoningEffort,
      buildBlockedReason: mode === "build" && !effectiveBuildGate.canBuild && runControls.selection.providerId && runControls.selection.model
        ? effectiveBuildGate.blockedReason || "Build is blocked until the selected provider passes Orbit's Codex bridge checks."
        : undefined,
    });
  }, [codex, effectiveBuildGate.blockedReason, effectiveBuildGate.canBuild, fs.workspaceRoot, runControls.mode, runControls.selection, session.providerSettings.configs, threadUi.threadId]);

  const startAgentLoop = useCallback(async () => {
    const task = session.importedPlan?.plan.tasks.find((item) => item.status !== "done" && item.status !== "verified");
    const prompt = task
      ? `Execute this Build task with Codex sidecar:\n${task.title}\n\n${task.description}\n\nVerification:\n${task.verification.join("\n")}`
      : "Start a Codex Build turn for the current workspace.";
    await submitToCodex(prompt, "build");
  }, [session.importedPlan?.plan.tasks, submitToCodex]);

  const submitPlanMessage = useCallback(async (message: string) => {
    const parsed = parseCodingPlan(message);
    if (parsed.ok) {
      const imported = await session.importPlan(message, "composer-input.yaml");
      if (imported) {
        threadUi.renameThread(parsed.plan.title);
        setPlansByThreadId((prev) => ({
          ...prev,
          [threadUi.threadId]: {
            plan: parsed.plan,
            fileName: "composer-input.yaml",
            importedAt: new Date().toISOString(),
          },
        }));
      }
      void collectRuntimeContext();
      return imported;
    }
    await submitToCodex(message, "plan");
    void collectRuntimeContext();
    return true;
  }, [collectRuntimeContext, session, submitToCodex, threadUi]);

  const submitBuildMessage = useCallback(async (message: string) => {
    await submitToCodex(message, "build");
    return true;
  }, [submitToCodex]);

  const acceptPlanDraft = useCallback((eventId: string) => {
    const draft = codex.projection.events.find((event) => event.id === eventId)?.planDraft;
    if (draft) {
      session.restoreImportedPlan({
        plan: draft,
        fileName: "codex-plan-draft.yaml",
        importedAt: new Date().toISOString(),
      });
      setPlansByThreadId((prev) => ({
        ...prev,
        [threadUi.threadId]: {
          plan: draft,
          fileName: "codex-plan-draft.yaml",
          importedAt: new Date().toISOString(),
        },
      }));
      threadUi.renameThread(draft.title);
    }
    runControls.setMode("build");
  }, [codex.projection.events, runControls, session, threadUi]);

  const writeProjectContextFile = useCallback(async (path: string, content: string) => {
    if (!fs.workspaceRoot) throw new Error("Workspace is required to edit project context.");
    await invokeDesktop("write_workspace_context_file", { workspacePath: fs.workspaceRoot, path, content });
    await fs.refreshFileTree();
    await collectRuntimeContext();
  }, [collectRuntimeContext, fs]);

  const codexThreadModel = codex.projection.threadModel;
  const composerSubmitLocked = codexComposerSubmitLocked(codex.status, codex.activeTurn, codex.activeOperation);
  const codexInspectorModel = useMemo(() => ({
    ...codex.projection.inspectorModel,
    terminalRuns: [...codex.projection.inspectorModel.terminalRuns, ...fs.terminalRuns],
    counts: {
      ...codex.projection.inspectorModel.counts,
      terminal: codex.projection.inspectorModel.terminals.length + fs.terminalRuns.length,
    },
  }), [codex.projection.inspectorModel, fs.terminalRuns]);

  const sessionBrowserModel = useMemo(() => ({
    sessions: threadUi.threadList
      .filter((thread) => !sessionSearchQuery || (thread.title || thread.threadId).toLowerCase().includes(sessionSearchQuery.toLowerCase()))
      .map((thread) => ({
        threadId: thread.threadId,
        workspacePath: thread.workspacePath || fs.workspaceRoot,
        title: thread.title || "Untitled thread",
        lastActiveAt: thread.updatedAt,
        eventCount: codex.thread?.id === thread.threadId ? codex.items.length : 0,
        pendingActionCount: 0,
        lastSummary: codex.items[codex.items.length - 1]?.text || "",
        archived: Boolean(thread.archived),
        pinned: thread.pinned,
      })),
    selected: undefined,
    searchQuery: sessionSearchQuery,
    errors: [],
  }), [codex.items, codex.thread?.id, fs.workspaceRoot, sessionSearchQuery, threadUi.threadList]);

  const evaluateDeepSeekSmokeRun = useCallback(() => createDeepSeekSmokeRunRecord({
    events: codex.projection.events,
    actionRequired: codex.projection.actions,
    workspacePath: fs.workspaceRoot || "",
    model: runControls.selection.model || "codex-sidecar",
    threadId: codex.thread?.id || threadUi.threadId,
    runSessionId: codex.activeTurn?.id,
  }), [codex.activeTurn?.id, codex.projection.actions, codex.projection.events, codex.thread?.id, fs.workspaceRoot, runControls.selection.model, threadUi.threadId]);

  const actionRequired = codex.projection.actions;
  const threadEvents = codex.projection.events;
  const terminalRuns = [...codex.projection.terminalRuns, ...fs.terminalRuns];
  const pendingActions = actionRequired.map((action) => ({
    id: action.id,
    kind: action.kind === "question" ? "question" as const : action.kind === "patchReview" ? "patch" as const : action.kind === "verification" ? "verification" as const : "approval" as const,
    payloadId: action.id,
    title: action.title,
    detail: action.question || action.description,
    createdAt: action.createdAt,
  }));
  const createThread = useCallback((title?: string) => {
    setPlansByThreadId((prev) => ({
      ...prev,
      [threadUi.threadId]: session.importedPlan ?? prev[threadUi.threadId] ?? null,
    }));
    const nextThreadId = threadUi.createThread(title);
    session.clearImportedPlan();
    codex.clear();
    return nextThreadId;
  }, [codex, session, threadUi]);

  const switchThread = useCallback((nextThreadId: string) => {
    setPlansByThreadId((prev) => ({
      ...prev,
      [threadUi.threadId]: session.importedPlan ?? prev[threadUi.threadId] ?? null,
    }));
    session.restoreImportedPlan(plansByThreadId[nextThreadId] ?? null);
    codex.clear();
    threadUi.switchThread(nextThreadId);
  }, [codex, plansByThreadId, session, threadUi]);

  const deleteThreadById = useCallback((targetThreadId: string) => {
    const deletingActiveThread = targetThreadId === threadUi.threadId;
    threadUi.deleteThread(targetThreadId);
    if (deletingActiveThread) {
      session.clearImportedPlan();
      codex.clear();
    }
  }, [codex, session, threadUi]);

  return {
    isLoading: session.isLoading,
    importedPlan: session.importedPlan,
    importError: session.importError,
    providerSettings: session.providerSettings,
    apiKeys: session.apiKeys,
    credentialVaultProviders: session.credentialVaultProviders,
    credentialVaultAutoUnlock: session.credentialVaultAutoUnlock,
    isRealLLMActive: session.isRealLLMActive,
    activeLLMConfig: session.activeLLMConfig,
    runControls: effectiveRunControls,
    activeTitle: session.activeTitle,
    outputFiles: session.outputFiles,
    importPlan: session.importPlan,
    submitPlanMessage,
    acceptPlanDraft,
    clearImportedPlan: session.clearImportedPlan,
    updateTask: session.updateTask,
    addTask: session.addTask,
    deleteTask: session.deleteTask,
    moveTask: session.moveTask,
    updateProviderSettings: session.updateProviderSettings,
    updateApiKey: session.updateApiKey,
    unlockCredentialVault: session.unlockCredentialVault,
    disableCredentialVaultAutoUnlock: session.disableCredentialVaultAutoUnlock,
    effectiveSecurityPolicy,
    projectSecurityOverride,
    updateProjectSecurityOverride,
    workspaceRoot: fs.workspaceRoot,
    workspaceError: fs.workspaceError,
    workspaceFiles: fs.workspaceFiles,
    activeFilePath: fs.activeFilePath,
    activeFileContent: fs.activeFileContent,
    terminalLogs: fs.terminalLogs,
    terminalRuns,
    commandStatus: fs.commandStatus,
    viewFile: fs.viewFile,
    setWorkspaceRoot,
    refreshFileTree: fs.refreshFileTree,
    executeCommand: fs.executeCommand,
    threadEvents,
    runtimeMessages: codex.projection.runtimeMessages,
    emitThreadEvent: (_event: ThreadEvent) => undefined,
    updateThreadEvent: () => undefined,
    actionRequired,
    pendingActions,
    runSteps: codex.projection.runSteps,
    startCollaborationFlow: () => undefined,
    applyEventPatch: noopAsync,
    rollbackEventPatch: noopAsync,
    restoreCheckpoint: noopAsync,
    refinePatch: noopAsync,
    updateEventPatch: () => undefined,
    agentLoopPhase: codex.status === "running" ? ("executing" as const) : ("idle" as const),
    agentLoopToolCalls: [],
    agentLoopRunning: codex.status === "running",
    startAgentLoop,
    continueAgentRun: startAgentLoop,
    submitBuildMessage,
    cancelAgentLoop: codex.interrupt,
    buildEmbeddings: noopAsync,
    embeddingBuildProgress: null,
    streamingContent: "",
    streamingActive: codex.status === "running",
    canContinueCodexRun: false,
    codexThreadModel,
    codexInspectorModel,
    codexRuntimeSettings: codex.runtimeSettings,
    restartCodexRuntime: codex.restartRuntime,
    recoverCodexRuntime: codex.recoverRuntime,
    freezeDiagnosticsReport: codex.freezeDiagnosticsReport,
    providerBuildGate: effectiveBuildGate,
    composerSubmitLocked,
    sessionBrowserModel,
    sessionSearchQuery,
    setSessionSearchQuery,
    currentContextInspector,
    refreshCurrentContext: collectRuntimeContext,
    evaluateDeepSeekSmokeRun,
    writeProjectContextFile,
    answerActionRequiredQuestion: (id: string, input: unknown) => {
      const action = actionRequired.find((item) => item.id === id);
      const answer = typeof input === "string" ? input : JSON.stringify(input);
      if (action) void codex.resolveAction(action, true, answer);
    },
    cancelActionRequired: (id: string) => {
      const action = actionRequired.find((item) => item.id === id);
      if (action) void codex.resolveAction(action, false);
    },
    resolveActionRequired: (id: string, approved: boolean) => {
      const action = actionRequired.find((item) => item.id === id);
      if (action) void codex.resolveAction(action, approved);
    },
    updateActionRequiredGrantScope: () => undefined,
    revokeApprovalGrant: (_id?: string) => undefined,
    openNewWindow: () => windowActions.openNewWindow(fs.workspaceRoot || undefined),
    recentProjects: projectStore.recentProjects,
    visibleProjects: projectActions.visibleProjects,
    archivedProjects: projectActions.archivedProjects,
    projectUiState: projectActions.projectUiState,
    togglePinnedProject: projectActions.togglePinnedProject,
    archiveProject: projectActions.archiveProject,
    removeRecentProject: projectActions.removeRecentProject,
    renameProject: projectActions.renameProject,
    revealProject: projectActions.revealProject,
    isLoadingProjects: projectStore.isLoadingProjects,
    refreshProjects: projectStore.refreshProjects,
    layoutPreferences: layout.layoutPreferences,
    updateLayoutPreferences: layout.updateLayoutPreferences,
    toggleReviewDock: layout.toggleReviewDock,
    usageSnapshot: buildUsageSnapshot(terminalRuns, codexUsageTokenRecords(codex.projection.inspectorModel.usage)),
    threadId: threadUi.threadId,
    threadUiState: threadUi.threadUiState,
    threadList: threadUi.threadList,
    threadsByProject: threadUi.threadsByProject,
    createThread,
    switchThread,
    restoreThreadById: (threadId: string) => threadUi.archiveThreadById(threadId, false),
    updateThreadUiState: threadUi.updateThreadUiState,
    togglePinnedThread: threadUi.togglePinnedThread,
    renameThread: threadUi.renameThread,
    archiveThread: threadUi.archiveThread,
    togglePinnedThreadById: threadUi.togglePinnedThreadById,
    renameThreadById: threadUi.renameThreadById,
    archiveThreadById: threadUi.archiveThreadById,
    deleteThreadById,
  };
}
