import { useCallback, useEffect, useRef, useState } from "react";
import { parseCommandLine } from "../runtime/commandParser";
import { invokeDesktop, isDesktopRuntime } from "../runtime/desktopGateway";
import { isTauri } from "../utils/tauri";
import {
  appendTerminalOutput,
  completeTerminalRun,
  createTerminalRun,
  type TerminalRun,
} from "../domain/terminalRun";

const ACTIVE_WORKSPACE_KEY = "orbit-code.active-workspace.v1";
const LEGACY_ACTIVE_WORKSPACE_KEY = "agent-gui.active-workspace.v1";

function readStoredWorkspaceRoot(): string {
  if (typeof window === "undefined") return "";
  try {
    return normalizeStoredWorkspaceRoot(
      window.localStorage.getItem(ACTIVE_WORKSPACE_KEY) ||
      window.localStorage.getItem(LEGACY_ACTIVE_WORKSPACE_KEY) ||
      "",
    );
  } catch {
    return "";
  }
}

export function normalizeStoredWorkspaceRoot(path: string): string {
  const normalized = path.trim().replace(/[\\/]+$/, "");
  if (!normalized) return "";
  const separator = normalized.includes("\\") ? "\\" : "/";
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  if (parts[parts.length - 1] !== "src-tauri") return normalized;
  if (parts.length <= 1) return normalized;
  const parent = normalized.slice(0, -(separator + "src-tauri").length);
  return parent || separator;
}

function storeWorkspaceRoot(path: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, path);
  } catch {
    // UI persistence is best-effort; the Rust workspace root still remains authoritative.
  }
}

function clearStoredWorkspaceRoot(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
    window.localStorage.removeItem(LEGACY_ACTIVE_WORKSPACE_KEY);
  } catch {
    // Ignore storage failures in private or restricted contexts.
  }
}

export interface FileSystemState {
  workspaceRoot: string;
  workspaceError: string | null;
  workspaceFiles: string[];
  activeFilePath: string | null;
  activeFileContent: string | null;
  terminalLogs: Record<string, string>;
  terminalRuns: TerminalRun[];
  commandStatus: Record<string, { running: boolean; exitCode: number | null }>;

  viewFile: (path: string) => Promise<void>;
  setWorkspaceRoot: (path: string) => Promise<boolean>;
  refreshFileTree: () => Promise<void>;
  executeCommand: (taskId: string, rawCommand: string) => void;
  executeStructuredCommand: (input: {
    workspacePath?: string;
    threadId?: string;
    taskId: string;
    approvalId?: string;
    command: string;
    args?: string[];
    reason?: string;
    cwd?: string;
  }) => void;
  recordTerminalResult: (input: {
    workspacePath?: string;
    threadId?: string;
    taskId: string;
    approvalId?: string;
    cwd?: string;
    command: string;
    args?: string[];
    reason?: string;
    output: string;
    exitCode?: number | null;
  }) => string;
  recoverTerminalRuns: (runs: TerminalRun[], replace?: boolean) => void;
}

export function terminalRunLooksLikeVerification(run?: TerminalRun): boolean {
  if (!run) return false;
  const haystack = [
    run.reason,
    run.command,
    ...(run.args || []),
  ].join(" ");
  return /\bverify\b|\bverification\b|验证|校验/i.test(haystack);
}

export function useFileSystem(
  providerSettings: { sandboxMode?: string; security?: { sandboxMode?: string } },
  updateTask: (taskId: string, updates: any) => void,
  onCommandComplete: (taskId: string, exitCode: number | null, run?: TerminalRun) => void,
  initialTerminalRuns: TerminalRun[] = [],
): FileSystemState {
  const [workspaceRoot, setWorkspaceRootState] = useState("");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [activeFileContent, setActiveFileContent] = useState<string | null>(null);
  const [terminalLogs, setTerminalLogs] = useState<Record<string, string>>({});
  const [terminalRuns, setTerminalRuns] = useState<TerminalRun[]>(initialTerminalRuns);
  const [commandStatus, setCommandStatus] = useState<Record<string, { running: boolean; exitCode: number | null }>>({});
  const terminalRunsRef = useRef<TerminalRun[]>(initialTerminalRuns);

  useEffect(() => {
    terminalRunsRef.current = terminalRuns;
  }, [terminalRuns]);

  useEffect(() => {
    async function loadWorkspace() {
      if (!isDesktopRuntime()) {
        setWorkspaceError(null);
        return;
      }

      try {
        const storedRoot = readStoredWorkspaceRoot();
        let root = "";
        if (storedRoot) {
          try {
            root = await invokeDesktop<string>("set_workspace_root", { path: storedRoot });
          } catch {
            clearStoredWorkspaceRoot();
          }
        }
        if (!root) root = await invokeDesktop<string>("get_workspace_root");
        if (!root) {
          setWorkspaceRootState("");
          setWorkspaceFiles([]);
          setWorkspaceError(null);
          return;
        }
        const files = await invokeDesktop<string[]>("list_workspace_files", { workspacePath: root });
        setWorkspaceRootState(root);
        setWorkspaceFiles(files);
        storeWorkspaceRoot(root);
        setWorkspaceError(null);
      } catch {
        setWorkspaceRootState("");
        setWorkspaceFiles([]);
        setWorkspaceError(null);
      }
    }
    loadWorkspace();
  }, []);

  useEffect(() => {
    if (initialTerminalRuns.length === 0) return;
    setTerminalRuns((prev) => {
      const next = prev.length > 0 ? prev : initialTerminalRuns;
      terminalRunsRef.current = next;
      return next;
    });
  }, [initialTerminalRuns]);

  const viewFile = useCallback(async (path: string) => {
    if (!path) {
      setActiveFilePath(null);
      setActiveFileContent(null);
      return;
    }

    setActiveFilePath(path);
    if (!isDesktopRuntime()) {
      setActiveFileContent("Desktop runtime required for local file preview.");
      return;
    }
    try {
      const content = await invokeDesktop<string>("read_workspace_file", { path, workspacePath: workspaceRoot });
      setActiveFileContent(content);
    } catch (err) {
      setActiveFileContent(`读取文件失败:\n${err}`);
    }
  }, [workspaceRoot]);

  const setWorkspaceRoot = useCallback(async (path: string) => {
    if (!isDesktopRuntime()) {
      setWorkspaceError("Desktop runtime required for local workspace access.");
      return false;
    }

    const trimmed = path.trim();
    if (!trimmed) {
      clearStoredWorkspaceRoot();
      setWorkspaceError("Workspace path is required.");
      return false;
    }

    try {
      const root = await invokeDesktop<string>("set_workspace_root", { path: trimmed });
      const files = await invokeDesktop<string[]>("list_workspace_files", { workspacePath: root });
      setWorkspaceRootState(root);
      setWorkspaceFiles(files);
      storeWorkspaceRoot(root);
      setWorkspaceError(null);
      setActiveFilePath(null);
      setActiveFileContent(null);
      return true;
    } catch (err) {
      setWorkspaceError(String(err));
      return false;
    }
  }, []);

  const refreshFileTree = useCallback(async () => {
    if (!isDesktopRuntime()) return;
    try {
      const root = workspaceRoot || await invokeDesktop<string>("get_workspace_root");
      const files = await invokeDesktop<string[]>("list_workspace_files", { workspacePath: root });
      setWorkspaceRootState(root);
      setWorkspaceFiles(files);
      if (root) storeWorkspaceRoot(root);
      setWorkspaceError(null);
    } catch (e) {
      setWorkspaceError(String(e));
      console.error("Refresh file tree failed:", e);
    }
  }, [workspaceRoot]);

  const executeStructuredCommand = useCallback((input: {
    workspacePath?: string;
    threadId?: string;
    taskId: string;
    approvalId?: string;
    command: string;
    args?: string[];
    reason?: string;
    cwd?: string;
  }) => {
    const { taskId, command } = input;
    const args = input.args || [];
    const commandWorkspacePath = input.workspacePath || workspaceRoot;
    setTerminalLogs((prev) => ({ ...prev, [taskId]: "" }));
    const run = createTerminalRun({
      workspacePath: commandWorkspacePath,
      threadId: input.threadId,
      taskId,
      approvalId: input.approvalId,
      cwd: input.cwd,
      command,
      args,
      reason: input.reason,
    });
    terminalRunsRef.current = [...terminalRunsRef.current, run];
    setTerminalRuns(terminalRunsRef.current);
    setCommandStatus((prev) => ({ ...prev, [taskId]: { running: true, exitCode: null } }));
    updateTask(taskId, { status: "running" });

    if (isDesktopRuntime()) {
      const sandbox = providerSettings.security?.sandboxMode || providerSettings.sandboxMode || "none";
      invokeDesktop("run_command_async", {
        taskId, command, args, sandboxMode: sandbox, workspacePath: commandWorkspacePath, cwd: input.cwd || "",
      }).catch((err) => {
        setTerminalLogs((prev) => ({ ...prev, [taskId]: (prev[taskId] || "") + `Failed to execute: ${err}\n` }));
        setCommandStatus((prev) => ({ ...prev, [taskId]: { running: false, exitCode: 1 } }));
        updateTask(taskId, { status: "blocked" });
      });
    } else {
      setTerminalLogs((prev) => ({
        ...prev,
        [taskId]: "Desktop runtime required for command execution.\n",
      }));
      setCommandStatus((prev) => ({ ...prev, [taskId]: { running: false, exitCode: 1 } }));
      updateTask(taskId, { status: "blocked" });
    }
  }, [providerSettings, updateTask, workspaceRoot]);

  const executeCommand = useCallback((taskId: string, rawCommand: string) => {
    const parsed = parseCommandLine(rawCommand);
    if (!parsed) return;
    executeStructuredCommand({ taskId, command: parsed.command, args: parsed.args });
  }, [executeStructuredCommand]);

  const recordTerminalResult = useCallback((input: {
    workspacePath?: string;
    threadId?: string;
    taskId: string;
    approvalId?: string;
    cwd?: string;
    command: string;
    args?: string[];
    reason?: string;
    output: string;
    exitCode?: number | null;
  }) => {
    const run = createTerminalRun({
      workspacePath: input.workspacePath || workspaceRoot,
      threadId: input.threadId,
      taskId: input.taskId,
      approvalId: input.approvalId,
      cwd: input.cwd,
      command: input.command,
      args: input.args || [],
      reason: input.reason,
      output: input.output,
      exitCode: input.exitCode ?? null,
      status: input.exitCode === 0 ? "done" : "failed",
    });
    terminalRunsRef.current = [...terminalRunsRef.current, run];
    setTerminalRuns(terminalRunsRef.current);
    setTerminalLogs((prev) => ({ ...prev, [input.taskId]: input.output }));
    setCommandStatus((prev) => ({ ...prev, [input.taskId]: { running: false, exitCode: input.exitCode ?? null } }));
    return run.id;
  }, [workspaceRoot]);

  const recoverTerminalRuns = useCallback((runs: TerminalRun[], replace = false) => {
    terminalRunsRef.current = replace ? runs : terminalRunsRef.current.length > 0 ? terminalRunsRef.current : runs;
    setTerminalRuns(terminalRunsRef.current);
    setTerminalLogs((prev) => {
      if (!replace && Object.keys(prev).length > 0) return prev;
      return runs.reduce<Record<string, string>>((logs, run) => {
        if (run.output) logs[run.taskId] = run.output;
        return logs;
      }, {});
    });
    setCommandStatus((prev) => {
      if (!replace && Object.keys(prev).length > 0) return prev;
      return runs.reduce<Record<string, { running: boolean; exitCode: number | null }>>((statuses, run) => {
        statuses[run.taskId] = { running: run.status === "running", exitCode: run.exitCode };
        return statuses;
      }, {});
    });
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let active = true;

    async function setupListener() {
      if (!isTauri()) return;
      try {
        const { listen } = await import("@tauri-apps/api/event");
        if (!active) return;

        unlisten = await listen<{ taskId: string; text: string; done: boolean; exitCode: number | null }>(
          "command-output",
          (event) => {
            const { taskId, text, done, exitCode } = event.payload;

            setTerminalLogs((prev) => ({
              ...prev,
              [taskId]: (prev[taskId] || "") + text,
            }));
            if (text) {
              terminalRunsRef.current = appendTerminalOutput(terminalRunsRef.current, taskId, text);
              setTerminalRuns(terminalRunsRef.current);
            }

            if (done) {
              const runningRun = [...terminalRunsRef.current]
                .reverse()
                .find((run) => run.taskId === taskId && run.status === "running");
              terminalRunsRef.current = completeTerminalRun(terminalRunsRef.current, taskId, exitCode);
              const completedRun = runningRun
                ? terminalRunsRef.current.find((run) => run.id === runningRun.id)
                : terminalRunsRef.current.find((run) => run.taskId === taskId);
              setTerminalRuns(terminalRunsRef.current);
              setCommandStatus((prev) => ({
                ...prev,
                [taskId]: { running: false, exitCode },
              }));

              updateTask(taskId, {
                status: exitCode === 0
                  ? (terminalRunLooksLikeVerification(completedRun) ? "verified" : "review")
                  : "blocked",
              });

              onCommandComplete(taskId, exitCode, completedRun);
            }
          }
        );
      } catch (err) {
        console.warn("Failed to load Tauri event listener:", err);
      }
    }

    setupListener();

    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, [updateTask, onCommandComplete]);

  return {
    workspaceRoot, workspaceError,
    workspaceFiles, activeFilePath, activeFileContent,
    terminalLogs, commandStatus,
    terminalRuns,
    viewFile, setWorkspaceRoot, refreshFileTree, executeCommand, executeStructuredCommand, recordTerminalResult, recoverTerminalRuns,
  };
}
