import { invoke } from "@tauri-apps/api/core";
import { callLLMApi, type LLMProvider } from "../services/llmService";
import { isTauri } from "../utils/tauri";

export interface SearchResult {
  file: string;
  line: number;
  preview: string;
  score: number;
}

/**
 * Semantic code search. Tries vector retrieval first (Rust embedding DB).
 * Falls back to LLM-based ranking if no embeddings have been built.
 */
export async function semanticSearch(
  query: string,
  provider?: LLMProvider,
  model?: string,
  baseUrl?: string,
  topK: number = 10,
  workspacePath: string = ""
): Promise<SearchResult[]> {
  if (!isTauri()) {
    return [];
  }

  // 1. Try vector retrieval first
  try {
    const results = await invoke<any>("semantic_search_cmd", { query, topK });
    if (results && Array.isArray(results) && results.length > 0) {
      return results.map((r: any) => ({
        file: r.file_path,
        line: r.start_line,
        preview: r.content_preview,
        score: r.score,
      }));
    }
  } catch (e) {
    console.warn("[SemanticSearch] Vector search unavailable, falling back to LLM:", e);
  }

  // 2. Fallback: LLM-based ranking (requires provider + model)
  if (provider && model) {
    return llmBasedSearch(query, provider, model, baseUrl, topK, workspacePath);
  }

  return [];
}

/**
 * LLM-based search fallback. Chunks files and asks LLM to rank relevance.
 */
async function llmBasedSearch(
  query: string,
  provider: LLMProvider,
  model: string,
  baseUrl?: string,
  topK: number = 10,
  workspacePath: string = ""
): Promise<SearchResult[]> {
  try {
    const files = await invoke<string[]>("list_workspace_files", { workspacePath });
    const sourceFiles = files.filter(f =>
      /\.(ts|tsx|js|jsx|py|rs|css|html|md)$/.test(f)
    );

    const allChunks: Array<{ file: string; startLine: number; endLine: number; content: string }> = [];
    for (const file of sourceFiles.slice(0, 100)) {
      try {
        const content = await invoke<string>("read_workspace_file", { path: file, workspacePath });
        const lines = content.split("\n");
        const chunkSize = 40;
        for (let i = 0; i < lines.length; i += chunkSize / 2) {
          const end = Math.min(i + chunkSize, lines.length);
          allChunks.push({
            file,
            startLine: i + 1,
            endLine: end,
            content: lines.slice(i, end).join("\n"),
          });
          if (allChunks.length > 500) break;
        }
      } catch {
        /* skip unreadable */
      }
      if (allChunks.length > 500) break;
    }

    if (allChunks.length === 0) return [];

    const chunksDesc = allChunks.map((c, i) =>
      `[${i}] ${c.file}:${c.startLine}-${c.endLine}\n${c.content.substring(0, 200)}`
    ).join("\n\n");

    const prompt = `You are a code search engine. Given the query below, rank the top ${topK} most relevant code chunks by returning their indices in order of relevance.

Query: ${query}

Code chunks:
${chunksDesc}

Return ONLY a JSON array of indices like: [3, 7, 1, ...]`;

    const result = await callLLMApi(
      provider,
      model,
      "You are a precise code search engine. Return only JSON arrays.",
      prompt,
      baseUrl
    );

    const match = result.match(/\[[\d,\s]+\]/);
    if (!match) return [];

    const indices: number[] = JSON.parse(match[0]);
    return indices
      .slice(0, topK)
      .map((idx, rank) => {
        const chunk = allChunks[idx];
        if (!chunk) return null;
        return {
          file: chunk.file,
          line: chunk.startLine,
          preview: chunk.content.substring(0, 120),
          score: 1 - rank / topK,
        };
      })
      .filter(Boolean) as SearchResult[];
  } catch (e) {
    console.warn("[LLMSearch] Failed:", e);
    return [];
  }
}

export async function gatherTaskContext(
  taskDescription: string,
  provider: LLMProvider,
  model: string,
  baseUrl?: string,
  workspacePath: string = ""
): Promise<string> {
  if (!isTauri()) return "[Browser mode - no context available]";

  try {
    // Vector search first (no provider/model needed if embeddings built)
    const searchResults = await semanticSearch(taskDescription, undefined, undefined, undefined, 8, workspacePath);
    // If no results and provider available, retry with LLM fallback
    const finalResults = searchResults.length > 0
      ? searchResults
      : await semanticSearch(taskDescription, provider, model, baseUrl, 8, workspacePath);

    const relevantFiles = [...new Set(finalResults.map(r => r.file))];

    let context = "=== Relevant Code Context ===\n\n";
    if (finalResults.length > 0) {
      context += "Matching code snippets:\n";
      for (const r of finalResults) {
        context += `${r.file}:${r.line} [score: ${r.score.toFixed(2)}]\n  ${r.preview}\n\n`;
      }
    } else {
      context += "(No relevant code found. Build the code index for better results.)\n\n";
    }

    // Read top 2 most relevant files
    context += "\n=== Full Content of Key Files ===\n";
    for (const file of relevantFiles.slice(0, 2)) {
      try {
        const content = await invoke<string>("read_workspace_file", { path: file, workspacePath });
        const preview = content.length > 2500
          ? content.substring(0, 2500) + "\n... (truncated)"
          : content;
        context += `\n--- ${file} ---\n${preview}\n`;
      } catch {
        /* skip */
      }
    }

    // Include code graph if available
    try {
      const graph = await invoke<any>("build_code_graph", { workspacePath });
      const relevantNodes = (graph.nodes || []).filter((n: any) =>
        relevantFiles.some(f => n.file_path && n.file_path.includes(f))
      );
      if (relevantNodes.length > 0) {
        context += "\n=== Relevant Code Symbols ===\n";
        for (const node of relevantNodes.slice(0, 15)) {
          context += `  [${node.kind}] ${node.name} @ ${node.file_path}:${node.line}\n`;
        }
      }
    } catch {
      /* graph not available */
    }

    return context;
  } catch (e) {
    return `[Context gathering failed: ${e}]`;
  }
}
