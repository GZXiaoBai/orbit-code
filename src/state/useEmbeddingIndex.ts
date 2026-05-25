import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentEvent } from "./useWorkspace";

export interface EmbeddingBuildProgress {
  phase: string;
  current: number;
  total: number;
  message: string;
}

interface UseEmbeddingIndexOptions {
  onEvent: (event: AgentEvent) => void;
}

export function useEmbeddingIndex({ onEvent }: UseEmbeddingIndexOptions) {
  const [embeddingBuildProgress, setEmbeddingBuildProgress] = useState<EmbeddingBuildProgress | null>(null);

  const buildEmbeddings = useCallback(async () => {
    setEmbeddingBuildProgress({
      phase: "building",
      current: 0,
      total: 0,
      message: "Building code index...",
    });
    try {
      const stats = await invoke<any>("build_embeddings");
      setEmbeddingBuildProgress(null);
      onEvent({
        id: `embed-${Date.now()}`,
        role: "planner",
        name: "Index Builder",
        status: "done",
        message: `Code index built: ${stats.total_chunks} chunks, ${stats.new_embeddings} new, ${stats.updated_embeddings} updated, ${stats.deleted_chunks} deleted (${stats.duration_secs.toFixed(1)}s) -- semantic search now available.`,
        timestamp: new Date().toLocaleTimeString(),
      });
    } catch (e: any) {
      setEmbeddingBuildProgress(null);
      console.error("Build embeddings failed:", e);
    }
  }, [onEvent]);

  return {
    buildEmbeddings,
    embeddingBuildProgress,
  };
}
