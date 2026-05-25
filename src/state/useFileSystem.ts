import { useCallback, useEffect, useState } from "react";
import { parseCommandLine } from "../runtime/commandParser";
import { invokeDesktop, isDesktopRuntime } from "../runtime/desktopGateway";
import { isTauri } from "../utils/tauri";
import {
  appendTerminalOutput,
  completeTerminalRun,
  createTerminalRun,
  type TerminalRun,
} from "../domain/terminalRun";

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
    taskId: string;
    command: string;
    args?: string[];
    reason?: string;
    workspacePath?: string;
  }) => void;
  recordTerminalResult: (input: {
    taskId: string;
    command: string;
    args?: string[];
    reason?: string;
    output: string;
    exitCode?: number | null;
  }) => string;
}

export function useFileSystem(
  providerSettings: { sandboxMode?: string; security?: { sandboxMode?: string } },
  updateTask: (taskId: string, updates: any) => void,
  onCommandComplete: (taskId: string, exitCode: number | null) => void,
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

  useEffect(() => {
    async function loadWorkspace() {
      if (!isDesktopRuntime()) {
        setWorkspaceError(null);
        return;
      }

      try {
        const root = await invokeDesktop<string>("get_workspace_root");
        if (!root) {
          setWorkspaceRootState("");
          setWorkspaceFiles([]);
          setWorkspaceError(null);
          return;
        }
        const files = await invokeDesktop<string[]>("list_workspace_files", { workspacePath: root });
        setWorkspaceRootState(root);
        setWorkspaceFiles(files);
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
    setTerminalRuns((prev) => (prev.length > 0 ? prev : initialTerminalRuns));
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
      setWorkspaceError("Workspace path is required.");
      return false;
    }

    try {
      const root = await invokeDesktop<string>("set_workspace_root", { path: trimmed });
      const files = await invokeDesktop<string[]>("list_workspace_files", { workspacePath: root });
      setWorkspaceRootState(root);
      setWorkspaceFiles(files);
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
      setWorkspaceError(null);
    } catch (e) {
      setWorkspaceError(String(e));
      console.error("Refresh file tree failed:", e);
    }
  }, [workspaceRoot]);

  const executeStructuredCommand = useCallback((input: {
    taskId: string;
    command: string;
    args?: string[];
    reason?: string;
    workspacePath?: string;
  }) => {
    const { taskId, command } = input;
    const args = input.args || [];
    const commandWorkspacePath = input.workspacePath || workspaceRoot;
    setTerminalLogs((prev) => ({ ...prev, [taskId]: "" }));
    setTerminalRuns((prev) => [...prev, createTerminalRun({ taskId, command, args, reason: input.reason })]);
    setCommandStatus((prev) => ({ ...prev, [taskId]: { running: true, exitCode: null } }));
    updateTask(taskId, { status: "running" });

    if (isDesktopRuntime()) {
      const sandbox = providerSettings.security?.sandboxMode || providerSettings.sandboxMode || "none";
      invokeDesktop("run_command_async", {
        taskId, command, args, sandboxMode: sandbox, workspacePath: commandWorkspacePath,
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
    taskId: string;
    command: string;
    args?: string[];
    reason?: string;
    output: string;
    exitCode?: number | null;
  }) => {
    const run = createTerminalRun({
      taskId: input.taskId,
      command: input.command,
      args: input.args || [],
      reason: input.reason,
      output: input.output,
      exitCode: input.exitCode ?? null,
      status: input.exitCode === 0 ? "done" : "failed",
    });
    setTerminalRuns((prev) => [...prev, run]);
    setTerminalLogs((prev) => ({ ...prev, [input.taskId]: input.output }));
    setCommandStatus((prev) => ({ ...prev, [input.taskId]: { running: false, exitCode: input.exitCode ?? null } }));
    return run.id;
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
              setTerminalRuns((prev) => appendTerminalOutput(prev, taskId, text));
            }

            if (done) {
              setTerminalRuns((prev) => completeTerminalRun(prev, taskId, exitCode));
              setCommandStatus((prev) => ({
                ...prev,
                [taskId]: { running: false, exitCode },
              }));

              if (exitCode === 0) {
                updateTask(taskId, { status: "done" });
              } else {
                updateTask(taskId, { status: "blocked" });
              }

              onCommandComplete(taskId, exitCode);
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
    viewFile, setWorkspaceRoot, refreshFileTree, executeCommand, executeStructuredCommand, recordTerminalResult,
  };
}
