import { useCallback, type MutableRefObject } from "react";
import type { ThreadEvent } from "../domain/threadEvents";
import { callLLMApi, CODER_SYSTEM_PROMPT } from "../services/llmService";
import type { FileSystemState } from "./useFileSystem";
import type { SessionState } from "./useSession";
import { markEventPatchesApplied, type PatchItem } from "./patchWorkflow";
import { invokeDesktop, isDesktopRuntime } from "../runtime/desktopGateway";
import { createThreadEvent } from "../domain/threadEvents";
import { createPatchCheckpoint, restorePatchCheckpoint } from "./patchCheckpoint";

interface SandboxPreviewResult {
  id: string;
  proposal_id: string;
  sandbox_path: string;
  status: "sandboxed" | "failed";
  output: string;
  created_at: string;
}

async function previewWorkspacePatches(
  proposalId: string,
  workspacePath: string,
  patches: PatchItem[],
): Promise<PatchItem[]> {
  if (!isDesktopRuntime()) {
    return patches.map((patch) => ({
      ...patch,
      sandboxStatus: "sandboxed",
      sandboxPath: "browser-fixture",
      sandboxOutput: "Browser fixture sandbox preview completed. No workspace files were changed.",
      applyStatus: "proposed",
    }));
  }

  try {
    const preview = await invokeDesktop<SandboxPreviewResult>("preview_workspace_patches_in_sandbox", {
      workspacePath,
      proposalId,
      patches: patches.map((patch) => ({
        path: patch.path,
        old_content: patch.oldContent,
        new_content: patch.newContent,
      })),
    });
    return patches.map((patch) => ({
      ...patch,
      sandboxStatus: preview.status,
      sandboxPath: preview.sandbox_path,
      sandboxOutput: preview.output,
      applyStatus: "proposed",
    }));
  } catch (err: any) {
    const message = err?.message || String(err);
    return patches.map((patch) => ({
      ...patch,
      sandboxStatus: "failed",
      sandboxOutput: message,
      applyStatus: "failed",
    }));
  }
}

interface UsePatchWorkflowArgs {
  threadEventsRef: MutableRefObject<ThreadEvent[]>;
  updateThreadEvent: (id: string, update: Partial<ThreadEvent> | ((event: ThreadEvent) => ThreadEvent)) => void;
  emitThreadEvent: (event: ThreadEvent) => void;
  fs: FileSystemState;
  isRealLLMActiveRef: MutableRefObject<boolean>;
  activeLLMConfigRef: MutableRefObject<SessionState["activeLLMConfig"]>;
  onPatchApplied?: (eventId: string) => void;
  onCheckpointCreated?: (checkpointId: string, event: ThreadEvent) => void;
}

export function usePatchWorkflow({
  threadEventsRef,
  updateThreadEvent,
  emitThreadEvent,
  fs,
  isRealLLMActiveRef,
  activeLLMConfigRef,
  onPatchApplied,
  onCheckpointCreated,
}: UsePatchWorkflowArgs) {
  const applyEventPatch = useCallback(async (eventId: string) => {
    let event = threadEventsRef.current.find(e => e.id === eventId);
    if (!event || !event.patches || event.patches.length === 0) return;

    if (event.patches.some((patch) => !patch.applied && patch.sandboxStatus !== "sandboxed")) {
      const retriedPatches = await previewWorkspacePatches(eventId, fs.workspaceRoot, event.patches);
      updateThreadEvent(eventId, (current) => ({
        ...current,
        message: retriedPatches.some((patch) => patch.sandboxStatus === "failed")
          ? "沙盒预演重试失败。当前工作区没有被修改，请调整补丁后再次重试。"
          : "沙盒预演重试通过。请重新确认后应用补丁。",
        patches: retriedPatches,
      }));
      event = { ...event, patches: retriedPatches };
      if (!retriedPatches.some((patch) => !patch.applied && patch.sandboxStatus === "failed")) {
        return;
      }
    }

    const eventPatches = event.patches || [];
    const sandboxFailure = eventPatches.find((patch) => !patch.applied && patch.sandboxStatus === "failed");
    if (sandboxFailure) {
      throw new Error(sandboxFailure.sandboxOutput || "沙盒预演失败，真实工作区未写入。请修正补丁后重试。");
    }

    try {
      if (isDesktopRuntime()) {
        const processedPatches: PatchItem[] = [];
        let hasAnyConflict = false;

        for (const patch of eventPatches) {
          if (patch.applied) {
            continue;
          }

          if (patch.conflictResolved) {
            let diskContent = patch.oldContent;
            try {
              diskContent = await invokeDesktop<string>("read_workspace_file", {
                path: patch.path,
                workspacePath: fs.workspaceRoot,
              });
            } catch {
              diskContent = "";
            }
            processedPatches.push({
              ...patch,
              oldContent: diskContent,
              newContent: patch.resolvedContent || patch.newContent,
            });
            continue;
          }

          const mergeResult = await invokeDesktop<{ success: boolean; merged_content: string; has_conflict: boolean }>(
            "resolve_patch_conflict",
            {
              path: patch.path,
              oldContent: patch.oldContent,
              newContent: patch.newContent,
              workspacePath: fs.workspaceRoot,
            }
          );

          if (mergeResult.has_conflict) {
            hasAnyConflict = true;
            processedPatches.push({
              ...patch,
              hasConflict: true,
              conflictContent: mergeResult.merged_content,
              resolvedContent: mergeResult.merged_content,
              applyStatus: "failed",
            });
          } else {
            let diskContent = patch.oldContent;
            try {
              diskContent = await invokeDesktop<string>("read_workspace_file", {
                path: patch.path,
                workspacePath: fs.workspaceRoot,
              });
            } catch {
              diskContent = "";
            }
            processedPatches.push({
              ...patch,
              oldContent: diskContent,
              newContent: mergeResult.merged_content,
              hasConflict: false,
            });
          }
        }

        if (hasAnyConflict) {
          updateThreadEvent(eventId, (event) => ({
            ...event,
            message: "检测到本地磁盘代码在协作等待期间发生了用户手动修改，触发了三方合并冲突！请解决冲突后再重新应用。",
            patches: processedPatches,
          }));
          return;
        }

        if (processedPatches.length === 0) return;

        let checkpointId = "";
        let checkpointStrategy: "git-shadow" | "file-snapshot" = "file-snapshot";
        try {
          const checkpoint = await createPatchCheckpoint({
            eventId,
            workspacePath: fs.workspaceRoot,
            patches: processedPatches,
          });
          checkpointId = checkpoint.id;
          checkpointStrategy = checkpoint.strategy;
          emitThreadEvent(createThreadEvent({
            kind: "checkpoint",
            workspacePath: fs.workspaceRoot,
            threadId: event.threadId,
            taskId: event.taskId,
            runSessionId: event.runSessionId,
            role: "reviewer",
            title: "Patch Checkpoint",
            status: "done",
            message: checkpoint.strategy === "git-shadow"
              ? `已在应用补丁前创建 Git shadow checkpoint：${checkpoint.files.map((file) => file.path).join(", ")}`
              : `已在应用补丁前创建文件快照：${checkpoint.files.map((file) => file.path).join(", ")}`,
            checkpoint: {
              checkpointId: checkpoint.id,
              strategy: checkpoint.strategy,
              filePaths: checkpoint.files.map((file) => file.path),
              status: "created",
            },
          }));
          onCheckpointCreated?.(checkpoint.id, event);
        } catch (err: any) {
          const message = err?.message || String(err);
          emitThreadEvent(createThreadEvent({
            kind: "checkpoint",
            workspacePath: fs.workspaceRoot,
            threadId: event.threadId,
            taskId: event.taskId,
            runSessionId: event.runSessionId,
            role: "reviewer",
            title: "Patch Checkpoint Failed",
            status: "done",
            message: `应用补丁前创建文件快照失败：${message}`,
            checkpoint: {
              checkpointId: `checkpoint-failed-${Date.now()}`,
              strategy: "file-snapshot",
              filePaths: processedPatches.map((patch) => patch.path),
              status: "failed",
              error: message,
            },
          }));
          throw new Error(`创建补丁 checkpoint 失败，已停止写入：${message}`);
        }

        await invokeDesktop("apply_workspace_patches_transactional", {
          workspacePath: fs.workspaceRoot,
          patches: processedPatches.map(patch => ({
            path: patch.path,
            old_content: patch.oldContent,
            new_content: patch.newContent,
          })),
        });

        await fs.refreshFileTree();
        if (fs.activeFilePath) {
          await fs.viewFile(fs.activeFilePath);
        }

        updateThreadEvent(eventId, (event) => ({
          ...markEventPatchesApplied([event], eventId, processedPatches)[0],
          checkpoint: checkpointId
            ? {
              checkpointId,
              strategy: checkpointStrategy,
              filePaths: processedPatches.map((patch) => patch.path),
              status: "created",
              }
            : event.checkpoint,
        }));

        onPatchApplied?.(eventId);
      } else {
        updateThreadEvent(eventId, (event) => event.patches
          ? { ...event, message: "桌面运行时不可用，无法写入本地文件。" }
          : event);
      }
    } catch (err: any) {
      throw new Error(err || "写入本地失败");
    }
  }, [emitThreadEvent, fs, onCheckpointCreated, onPatchApplied, threadEventsRef, updateThreadEvent]);

  const rollbackEventPatch = useCallback(async (eventId: string) => {
    const event = threadEventsRef.current.find((item) => item.id === eventId);
    const checkpointId = event?.checkpoint?.checkpointId;
    if (!event || !checkpointId) {
      throw new Error("该补丁没有可恢复的 checkpoint。");
    }
    const checkpointFilePaths = event.checkpoint?.filePaths || event.patches?.map((patch) => patch.path) || [];
    const rollbackEventId = `rollback-${Date.now()}`;
    emitThreadEvent(createThreadEvent({
      id: rollbackEventId,
      kind: "rollback",
      workspacePath: event.workspacePath || fs.workspaceRoot,
      threadId: event.threadId,
      taskId: event.taskId,
      runSessionId: event.runSessionId,
      role: "reviewer",
      title: "Patch Rollback",
      status: "thinking",
      message: `正在从 checkpoint 恢复：${checkpointId}`,
      rollback: {
        checkpointId,
        filePaths: checkpointFilePaths,
        status: "running",
        actor: "user",
      },
    }));

    try {
      const checkpoint = await restorePatchCheckpoint(checkpointId);
      await fs.refreshFileTree();
      if (fs.activeFilePath) await fs.viewFile(fs.activeFilePath);
      updateThreadEvent(rollbackEventId, {
        status: "done",
        message: `已回滚文件：${checkpoint.files.map((file) => file.path).join(", ")}`,
        rollback: {
          checkpointId,
          filePaths: checkpoint.files.map((file) => file.path),
          status: "restored",
          actor: "user",
        },
      });
    } catch (err: any) {
      const message = err?.message || String(err);
      updateThreadEvent(rollbackEventId, {
        status: "done",
        message: `回滚失败：${message}`,
        rollback: {
          checkpointId,
          filePaths: checkpointFilePaths,
          status: "failed",
          actor: "user",
          error: message,
        },
      });
      throw new Error(message);
    }
  }, [emitThreadEvent, fs, threadEventsRef, updateThreadEvent]);

  const refinePatch = useCallback(async (eventId: string, feedback: string) => {
    const event = threadEventsRef.current.find(e => e.id === eventId);
    if (!event || !event.patches || event.patches.length === 0) return;

    const patchItem = event.patches[0];
    const filePath = patchItem.path;
    const oldContent = patchItem.oldContent;
    const lastFailedContent = patchItem.newContent;

    if (isRealLLMActiveRef.current && activeLLMConfigRef.current) {
      updateThreadEvent(eventId, {
        status: "thinking",
        message: `正在接收微调反馈："${feedback}"，重新生成补丁中...`,
      });

      try {
        const refinePrompt = `
          当前需要对以下文件的代码做增量调整。
          文件路径: ${filePath}

          原始代码:\n${oldContent}

          当前代码补丁:\n${lastFailedContent}

          用户的微调意见: "${feedback}"

          请根据用户的微调意见，在当前代码补丁的基础上重新局部修改，不要提供任何文字解释，不要用 markdown 代码块包裹，直接输出修改后的完整源码内容。
        `;

        const refinedCode = await callLLMApi(
          activeLLMConfigRef.current.provider,
          activeLLMConfigRef.current.model,
          CODER_SYSTEM_PROMPT,
          refinePrompt,
          activeLLMConfigRef.current.url
        );

        updateThreadEvent(eventId, {
          status: "done",
          message: `根据您的微调意见："${feedback}"，我已重构了补丁内容。请在下方卡片中做 Diff 审查并批准应用更改。`,
          patches: [{
            path: filePath,
            oldContent,
            newContent: refinedCode,
            applied: false,
          }],
        });
      } catch (err: any) {
        updateThreadEvent(eventId, {
          status: "done",
          message: `重生成微调补丁失败: ${err?.message || String(err)}。原补丁仍然保留。`,
        });
      }
    } else {
      updateThreadEvent(eventId, {
        message: `需要先在设置中配置模型 API Key，才能根据反馈重新生成补丁："${feedback}"。`,
      });
    }
  }, [activeLLMConfigRef, isRealLLMActiveRef, threadEventsRef, updateThreadEvent]);

  const updateEventPatch = useCallback((eventId: string, patchPath: string, updates: Partial<PatchItem>) => {
    updateThreadEvent(eventId, (event) => event.patches
      ? {
          ...event,
          patches: event.patches.map(patch => patch.path === patchPath ? { ...patch, ...updates } : patch),
        }
      : event);
  }, [updateThreadEvent]);

  return {
    applyEventPatch,
    rollbackEventPatch,
    refinePatch,
    updateEventPatch,
  };
}
