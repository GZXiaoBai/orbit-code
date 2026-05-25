import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { AgentEvent } from "../domain/agentEvents";
import { callLLMApi, CODER_SYSTEM_PROMPT } from "../services/llmService";
import type { FileSystemState } from "./useFileSystem";
import type { SessionState } from "./useSession";
import { markEventPatchesApplied, type PatchItem } from "./patchWorkflow";
import { invokeDesktop, isDesktopRuntime } from "../runtime/desktopGateway";

interface UsePatchWorkflowArgs {
  agentEventsRef: MutableRefObject<AgentEvent[]>;
  setAgentEvents: Dispatch<SetStateAction<AgentEvent[]>>;
  fs: FileSystemState;
  isRealLLMActiveRef: MutableRefObject<boolean>;
  activeLLMConfigRef: MutableRefObject<SessionState["activeLLMConfig"]>;
  onPatchApplied?: (eventId: string) => void;
}

export function usePatchWorkflow({
  agentEventsRef,
  setAgentEvents,
  fs,
  isRealLLMActiveRef,
  activeLLMConfigRef,
  onPatchApplied,
}: UsePatchWorkflowArgs) {
  const applyEventPatch = useCallback(async (eventId: string) => {
    const event = agentEventsRef.current.find(e => e.id === eventId);
    if (!event || !event.patches || event.patches.length === 0) return;
    const sandboxFailure = event.patches.find((patch) => patch.sandboxStatus === "failed");
    if (sandboxFailure) {
      throw new Error(sandboxFailure.sandboxOutput || "沙盒预演失败，真实工作区未写入。请修正补丁后重试。");
    }

    try {
      if (isDesktopRuntime()) {
        const processedPatches: PatchItem[] = [];
        let hasAnyConflict = false;

        for (const patch of event.patches) {
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
          setAgentEvents(prev => prev.map(e => {
            if (e.id !== eventId) return e;
            return {
              ...e,
              message: "检测到本地磁盘代码在协作等待期间发生了用户手动修改，触发了三方合并冲突！请解决冲突后再重新应用。",
            patches: processedPatches,
          };
        }));
        return;
        }

        if (processedPatches.length === 0) return;

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

        setAgentEvents(prev => markEventPatchesApplied(prev, eventId, processedPatches).map(e => {
          if (e.role !== "verifier") return e;
          return {
            ...e,
            status: "thinking",
            message: "多文件补丁已通过三方消解并安全写入。等待你批准验证命令后再运行测试。",
          };
        }));

        onPatchApplied?.(eventId);
      } else {
        setAgentEvents(prev => prev.map(e => {
          if (e.id !== eventId || !e.patches) return e;
          return {
            ...e,
            message: "桌面运行时不可用，无法写入本地文件。",
          };
        }));
      }
    } catch (err: any) {
      throw new Error(err || "写入本地失败");
    }
  }, [agentEventsRef, fs, onPatchApplied, setAgentEvents]);

  const refinePatch = useCallback(async (eventId: string, feedback: string) => {
    const event = agentEventsRef.current.find(e => e.id === eventId);
    if (!event || !event.patches || event.patches.length === 0) return;

    const patchItem = event.patches[0];
    const filePath = patchItem.path;
    const oldContent = patchItem.oldContent;
    const lastFailedContent = patchItem.newContent;

    if (isRealLLMActiveRef.current && activeLLMConfigRef.current) {
      setAgentEvents(prev => prev.map(e => {
        if (e.id !== eventId) return e;
        return {
          ...e,
          status: "thinking",
          message: `正在接收微调反馈："${feedback}"，重新生成补丁中...`,
        };
      }));

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

        setAgentEvents(prev => prev.map(e => {
          if (e.id !== eventId) return e;
          return {
            ...e,
            status: "done",
            message: `根据您的微调意见："${feedback}"，我已重构了补丁内容。请在下方卡片中做 Diff 审查并批准应用更改。`,
            patches: [{
              path: filePath,
              oldContent,
              newContent: refinedCode,
              applied: false,
            }],
          };
        }));
      } catch (err: any) {
        setAgentEvents(prev => prev.map(e => {
          if (e.id !== eventId) return e;
          return {
            ...e,
            status: "done",
            message: `重生成微调补丁失败: ${err?.message || String(err)}。原补丁仍然保留。`,
          };
        }));
      }
    } else {
      setAgentEvents(prev => prev.map(e => {
        if (e.id !== eventId) return e;
        return {
          ...e,
          message: `需要先在设置中配置模型 API Key，才能根据反馈重新生成补丁："${feedback}"。`,
        };
      }));
    }
  }, [activeLLMConfigRef, agentEventsRef, isRealLLMActiveRef, setAgentEvents]);

  const updateEventPatch = useCallback((eventId: string, patchPath: string, updates: Partial<PatchItem>) => {
    setAgentEvents(prev => prev.map(e => {
      if (e.id !== eventId || !e.patches) return e;
      return {
        ...e,
        patches: e.patches.map(patch => patch.path === patchPath ? { ...patch, ...updates } : patch),
      };
    }));
  }, [setAgentEvents]);

  return {
    applyEventPatch,
    refinePatch,
    updateEventPatch,
  };
}
