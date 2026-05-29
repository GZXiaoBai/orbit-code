import type { PatchItem } from "./patchWorkflow";
import { invokeDesktop, isDesktopRuntime } from "../runtime/desktopGateway";

const CHECKPOINT_STORAGE_KEY = "orbit-code.patch-checkpoints.v1";

export interface PatchCheckpointFile {
  path: string;
  content: string;
  existed: boolean;
}

export interface PatchCheckpoint {
  id: string;
  eventId: string;
  workspacePath: string;
  strategy: "git-shadow" | "file-snapshot";
  files: PatchCheckpointFile[];
  shadowPath?: string;
  createdAt: string;
}

function loadCheckpoints(): Record<string, PatchCheckpoint> {
  try {
    const raw = localStorage.getItem(CHECKPOINT_STORAGE_KEY);
    return raw ? JSON.parse(raw) as Record<string, PatchCheckpoint> : {};
  } catch {
    return {};
  }
}

function saveCheckpoints(checkpoints: Record<string, PatchCheckpoint>) {
  localStorage.setItem(CHECKPOINT_STORAGE_KEY, JSON.stringify(checkpoints));
}

export async function createPatchCheckpoint(input: {
  eventId: string;
  workspacePath: string;
  patches: PatchItem[];
}): Promise<PatchCheckpoint> {
  if (!isDesktopRuntime()) {
    throw new Error("Desktop runtime required for patch checkpoint.");
  }

  const files: PatchCheckpointFile[] = [];
  let strategy: PatchCheckpoint["strategy"] = "file-snapshot";
  const checkpointId = `checkpoint-${Date.now()}`;
  try {
    await invokeDesktop<string>("read_workspace_file", {
      path: ".git/HEAD",
      workspacePath: input.workspacePath,
    });
    strategy = "git-shadow";
  } catch {
    strategy = "file-snapshot";
  }

  for (const patch of input.patches) {
    try {
      const content = await invokeDesktop<string>("read_workspace_file", {
        path: patch.path,
        workspacePath: input.workspacePath,
      });
      files.push({ path: patch.path, content, existed: true });
    } catch {
      files.push({ path: patch.path, content: "", existed: false });
    }
  }

  let shadowPath: string | undefined;
  if (strategy === "git-shadow") {
    const result = await invokeDesktop<{ checkpoint_id: string; shadow_path: string }>(
      "create_workspace_git_shadow_checkpoint",
      {
        workspacePath: input.workspacePath,
        checkpointId,
        files: files.map((file) => ({
          path: file.path,
          content: file.content,
          existed: file.existed,
        })),
      },
    );
    shadowPath = result.shadow_path;
  }

  const checkpoint: PatchCheckpoint = {
    id: checkpointId,
    eventId: input.eventId,
    workspacePath: input.workspacePath,
    strategy,
    files,
    shadowPath,
    createdAt: new Date().toISOString(),
  };
  const checkpoints = loadCheckpoints();
  checkpoints[checkpoint.id] = checkpoint;
  saveCheckpoints(checkpoints);
  return checkpoint;
}

export async function restorePatchCheckpoint(checkpointId: string): Promise<PatchCheckpoint> {
  if (!isDesktopRuntime()) {
    throw new Error("Desktop runtime required for patch rollback.");
  }
  const checkpoint = loadCheckpoints()[checkpointId];
  if (!checkpoint) {
    throw new Error(`Patch checkpoint not found: ${checkpointId}`);
  }
  if (checkpoint.strategy === "git-shadow" && checkpoint.shadowPath) {
    await invokeDesktop("restore_workspace_git_shadow_checkpoint", {
      workspacePath: checkpoint.workspacePath,
      shadowPath: checkpoint.shadowPath,
      files: checkpoint.files.map((file) => ({
        path: file.path,
        content: file.content,
        existed: file.existed,
      })),
    });
    return checkpoint;
  }
  await invokeDesktop("restore_workspace_file_snapshot", {
    workspacePath: checkpoint.workspacePath,
    files: checkpoint.files.map((file) => ({
      path: file.path,
      content: file.content,
      existed: file.existed,
    })),
  });
  return checkpoint;
}
