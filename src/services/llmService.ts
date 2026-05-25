import { invoke } from "@tauri-apps/api/core";
import type { ReasoningEffort } from "../domain/types";
import { isTauri } from "../utils/tauri";
import { appendProviderPath, getProviderAdapter, isOpenAICompatibleProvider } from "../providers/providerAdapters";
import { findProvider } from "../providers/providerRegistry";

type TauriEventCallback<T> = (event: { payload: T }) => void;
type UnlistenFn = () => void;

let listenFn: (<T>(event: string, handler: TauriEventCallback<T>) => Promise<UnlistenFn>) | null = null;

async function getListen(): Promise<(<T>(event: string, handler: TauriEventCallback<T>) => Promise<UnlistenFn>)> {
  if (!listenFn) {
    const mod = await import("@tauri-apps/api/event") as { listen: <T>(event: string, handler: TauriEventCallback<T>) => Promise<UnlistenFn> };
    listenFn = mod.listen;
  }
  return listenFn;
}

export type LLMProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "deepseek"
  | "openrouter"
  | "xai"
  | "mistral"
  | "groq"
  | "qwen"
  | "kimi"
  | "siliconflow"
  | "zhipu"
  | "fixture";

export interface LLMRequestOptions {
  reasoningEffort?: ReasoningEffort;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface LLMCallRecord {
  id: string;
  provider: LLMProvider;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  timestamp: string;
  streamed: boolean;
}

export function optionsForReasoningEffort(reasoningEffort: ReasoningEffort): Required<LLMRequestOptions> {
  if (reasoningEffort === "auto") {
    return {
      reasoningEffort,
      temperature: 0.1,
      maxOutputTokens: 4000,
    };
  }

  if (reasoningEffort === "fast") {
    return {
      reasoningEffort,
      temperature: 0.05,
      maxOutputTokens: 2000,
    };
  }

  if (reasoningEffort === "deep") {
    return {
      reasoningEffort,
      temperature: 0.15,
      maxOutputTokens: 8000,
    };
  }

  if (reasoningEffort === "high") {
    return {
      reasoningEffort,
      temperature: 0.12,
      maxOutputTokens: 16000,
    };
  }

  if (reasoningEffort === "max") {
    return {
      reasoningEffort,
      temperature: 0.1,
      maxOutputTokens: 32000,
    };
  }

  return {
    reasoningEffort: "balanced",
    temperature: 0.1,
    maxOutputTokens: 4000,
  };
}

export function reasoningInstruction(reasoningEffort: ReasoningEffort = "balanced"): string {
  if (reasoningEffort === "auto") {
    return "Run mode: Auto. Match reasoning depth to the task and model capability.";
  }

  if (reasoningEffort === "fast") {
    return "Run mode: Fast. Prefer concise planning, inspect only the most relevant files, and keep tool calls focused.";
  }

  if (reasoningEffort === "deep") {
    return "Run mode: Deep. Spend more effort on architecture, edge cases, tests, and failure modes before proposing patches.";
  }

  if (reasoningEffort === "high") {
    return "Run mode: High. Use provider reasoning controls where available and inspect enough context before writing patches.";
  }

  if (reasoningEffort === "max") {
    return "Run mode: Max. Use the strongest available provider reasoning mode for difficult coding and architecture tasks.";
  }

  return "Run mode: Balanced. Use enough analysis to produce reliable code changes without unnecessary exploration.";
}

function applyReasoningOptions(systemPrompt: string, options?: LLMRequestOptions): string {
  if (!options?.reasoningEffort) return systemPrompt;
  return `${systemPrompt}\n\n${reasoningInstruction(options.reasoningEffort)}`;
}

function defaultModel(provider: LLMProvider) {
  return findProvider(provider)?.defaultModel || "gpt-4o";
}

// 获取服务商的 API endpoint
const getApiUrl = (provider: LLMProvider, model: string, baseUrl?: string): string => {
  const adapter = getProviderAdapter(provider);
  if (baseUrl) {
    return appendProviderPath(baseUrl, adapter.chatPath);
  }
  switch (provider) {
    case "openai":
      return "https://api.openai.com/v1/chat/completions";
    case "anthropic":
      return "https://api.anthropic.com/v1/messages";
    case "google":
      return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    case "deepseek":
      return "https://api.deepseek.com/chat/completions";
    case "openrouter":
      return "https://openrouter.ai/api/v1/chat/completions";
    case "xai":
      return "https://api.x.ai/v1/chat/completions";
    case "mistral":
      return "https://api.mistral.ai/v1/chat/completions";
    case "groq":
      return "https://api.groq.com/openai/v1/chat/completions";
    case "qwen":
      return "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
    case "kimi":
      return "https://api.moonshot.cn/v1/chat/completions";
    case "siliconflow":
      return "https://api.siliconflow.cn/v1/chat/completions";
    case "zhipu":
      return "https://open.bigmodel.cn/api/paas/v4/chat/completions";
    case "fixture":
      return "fixture://offline";
  }
};

function getFixtureResponse(userPrompt: string): string {
  if (userPrompt.includes("ASK_USER_FIXTURE") && !userPrompt.includes("[Tool ask_user result]")) {
    return '{"tool":"ask_user","params":{"question":"Which implementation path should the fixture continue with?"}}';
  }
  if (userPrompt.includes("[Tool ask_user result]") && !userPrompt.includes("[Tool read_file result]")) {
    return '{"tool":"read_file","params":{"path":"package.json"}}';
  }
  if (!userPrompt.includes("[Tool read_file result]")) {
    return '{"tool":"read_file","params":{"path":"package.json"}}';
  }
  if (!userPrompt.includes("[Tool run_command result]")) {
    return '{"tool":"run_command","params":{"command":"npm","args":["test","--","--run"],"reason":"Run the test suite before proposing file changes."}}';
  }
  if (!userPrompt.includes("[Tool apply_patch result]")) {
    return '{"tool":"apply_patch","params":{"patches":[{"path":"AGENT_GUI_FIXTURE.md","oldContent":"","newContent":"# Fixture Patch\\n\\nThis file was proposed by the offline fixture provider.\\n"}]}}';
  }
  return '{"tool":"done","params":{"summary":"Fixture run completed after command approval and patch proposal."}}';
}

// 拼接并清理大模型输出中的 Markdown 代码框 (如 ```json ... ```)
export function cleanJsonOutput(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n/, "");
    if (cleaned.endsWith("```")) {
      cleaned = cleaned.slice(0, -3);
    }
  }
  return cleaned.trim();
}

export async function callLLMApi(
  provider: LLMProvider,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  baseUrl?: string,
  onTokenUsage?: (record: LLMCallRecord) => void,
  options?: LLMRequestOptions,
): Promise<string> {
  const startTime = Date.now();
  const callId = `llm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  if (!isTauri()) {
    if (provider === "fixture") return getFixtureResponse(userPrompt);
    console.warn(`[LLM] Browser environment fallback to Mock for provider: ${provider}`);
    return getMockResponse(systemPrompt, userPrompt);
  }

  if (provider === "fixture") {
    return getFixtureResponse(userPrompt);
  }

  const apiUrl = getApiUrl(provider, model, baseUrl);
  const requestOptions = {
    ...optionsForReasoningEffort(options?.reasoningEffort || "balanced"),
    ...options,
  };
  const effectiveSystemPrompt = applyReasoningOptions(systemPrompt, requestOptions);
  let payload: any = {};

  // 构建 Payload
  if (isOpenAICompatibleProvider(provider)) {
    payload = {
      model: model || defaultModel(provider),
      messages: [
        { role: "system", content: effectiveSystemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: requestOptions.temperature,
    };
    if (provider === "openai") {
      payload.max_completion_tokens = requestOptions.maxOutputTokens;
    } else {
      payload.max_tokens = requestOptions.maxOutputTokens;
      if (requestOptions.reasoningEffort === "high" || requestOptions.reasoningEffort === "max") {
        payload.reasoning_effort = requestOptions.reasoningEffort;
      }
    }
  } else if (provider === "anthropic") {
    payload = {
      model: model || "claude-3-5-sonnet-latest",
      system: effectiveSystemPrompt,
      messages: [
        { role: "user", content: userPrompt }
      ],
      max_tokens: requestOptions.maxOutputTokens,
      temperature: requestOptions.temperature,
    };
  } else if (provider === "google") {
    payload = {
      contents: [
        {
          role: "user",
          parts: [
            { text: `${effectiveSystemPrompt}\n\n[USER REQUEST]:\n${userPrompt}` }
          ]
        }
      ],
      generationConfig: {
        temperature: requestOptions.temperature,
        maxOutputTokens: requestOptions.maxOutputTokens,
      }
    };
  }

  try {
    const rawResponse = await invoke<string>("call_llm_api", {
      provider,
      apiUrl,
      payload
    });

    const parsed = JSON.parse(rawResponse);
    let content = "";

    // 解析不同大模型的 Response
    if (isOpenAICompatibleProvider(provider)) {
      content = parsed.choices?.[0]?.message?.content || "";
    } else if (provider === "anthropic") {
      content = parsed.content?.[0]?.text || "";
    } else if (provider === "google") {
      content = parsed.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }

    // 提取 token 用量
    const usage = parsed.usage || {};
    const promptTokens = usage.prompt_tokens || usage.input_tokens || usage.promptTokenCount || 0;
    const completionTokens = usage.completion_tokens || usage.output_tokens || usage.candidatesTokenCount || 0;
    const totalTokens = usage.total_tokens || usage.totalTokenCount || (promptTokens + completionTokens);

    // 粗略估算 (fallback)
    const estimatedPrompt = Math.ceil((effectiveSystemPrompt.length + userPrompt.length) / 4);
    const estimatedCompletion = Math.ceil(content.length / 4);

    const record: LLMCallRecord = {
      id: callId,
      provider,
      model: model || "default",
      promptTokens: promptTokens || estimatedPrompt,
      completionTokens: completionTokens || estimatedCompletion,
      totalTokens: totalTokens || (estimatedPrompt + estimatedCompletion),
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      streamed: false,
    };

    onTokenUsage?.(record);
    return content || rawResponse;
  } catch (err: any) {
    console.error(`[LLM] API Call failed:`, err);
    throw new Error(err?.message || String(err));
  }
}

// 仿真模拟数据发生器
function getMockResponse(system: string, _user: string): string {
  if (system.includes("PLANNER_AGENT")) {
    return JSON.stringify({
      title: "优化侧边栏及工作区加载指示器",
      references: ["src/App.tsx", "src/components/Sidebar.tsx"],
      goals: [
        "优化侧边栏文件加载指示状态",
        "在主应用加载 SQLite 持久层时提供精致动效"
      ],
      tasks: [
        {
          id: "task-sidebar-1",
          title: "优化 App.tsx 的加载画面",
          description: "在 App.tsx 中将原本粗糙的 Loading 状态升级为带环形加载指示和暗色主题适配的高级画面。",
          verification: ["npm run build"],
          filesHint: ["src/App.tsx"]
        }
      ]
    });
  } else {
    // Coder 模拟
    return `// Mock coding agent response\nimport { useState } from "react";\n\nexport default function App() {\n  return <div>Mock Applied!</div>;\n}`;
  }
}

/* ==========================================================================
   流式 LLM 调用 (SSE Streaming)
   ========================================================================== */

export interface LLMStreamHandle {
  streamId: string;
  result: Promise<string>;
  cancel: () => void;
}

export function callLLMApiStreaming(
  provider: LLMProvider,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  baseUrl?: string,
  onChunk?: (content: string, accumulated: string) => void,
  options?: LLMRequestOptions,
): LLMStreamHandle {
  const streamId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  if (!isTauri()) {
    if (provider === "fixture") {
      const response = getFixtureResponse(userPrompt);
      onChunk?.(response, response);
      return {
        streamId,
        cancel: () => {},
        result: Promise.resolve(response),
      };
    }
    console.warn(`[LLM] Browser environment fallback to Mock for provider: ${provider}`);
    return {
      streamId,
      cancel: () => {},
      result: Promise.resolve(getMockResponse(systemPrompt, userPrompt)),
    };
  }

  const apiUrl = getApiUrl(provider, model, baseUrl);
  if (provider === "fixture") {
    const response = getFixtureResponse(userPrompt);
    onChunk?.(response, response);
    return {
      streamId,
      cancel: () => {},
      result: Promise.resolve(response),
    };
  }
  const requestOptions = {
    ...optionsForReasoningEffort(options?.reasoningEffort || "balanced"),
    ...options,
  };
  const effectiveSystemPrompt = applyReasoningOptions(systemPrompt, requestOptions);
  let payload: any = {};

  if (isOpenAICompatibleProvider(provider)) {
    payload = {
      model: model || defaultModel(provider),
      messages: [
        { role: "system", content: effectiveSystemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: requestOptions.temperature,
    };
    if (provider === "openai") {
      payload.max_completion_tokens = requestOptions.maxOutputTokens;
    } else {
      payload.max_tokens = requestOptions.maxOutputTokens;
      if (requestOptions.reasoningEffort === "high" || requestOptions.reasoningEffort === "max") {
        payload.reasoning_effort = requestOptions.reasoningEffort;
      }
    }
  } else if (provider === "anthropic") {
    payload = {
      model: model || "claude-3-5-sonnet-latest",
      system: effectiveSystemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      max_tokens: requestOptions.maxOutputTokens,
      temperature: requestOptions.temperature,
    };
  } else if (provider === "google") {
    payload = {
      contents: [{
        role: "user",
        parts: [{ text: `${effectiveSystemPrompt}\n\n[USER REQUEST]:\n${userPrompt}` }]
      }],
      generationConfig: {
        temperature: requestOptions.temperature,
        maxOutputTokens: requestOptions.maxOutputTokens,
      }
    };
  }

  let cancelled = false;

  const result = new Promise<string>(async (resolve, reject) => {
    try {
      const listen = await getListen();

      let fullContent = "";
      let settled = false;

      const unlistenChunk = await listen<{ streamId: string; content: string }>(
        "llm-stream-chunk",
        (event) => {
          if (event.payload.streamId !== streamId) return;
          fullContent += event.payload.content;
          onChunk?.(event.payload.content, fullContent);
        }
      );

      const unlistenEnd = await listen<{ streamId: string; status: string }>(
        "llm-stream-end",
        (event) => {
          if (event.payload.streamId !== streamId) return;
          if (settled) return;
          settled = true;
          unlistenChunk();
          unlistenEnd();
          unlistenError();
          resolve(fullContent);
        }
      );

      const unlistenError = await listen<{ streamId: string; error: string }>(
        "llm-stream-error",
        (event) => {
          if (event.payload.streamId !== streamId) return;
          if (settled) return;
          settled = true;
          unlistenChunk();
          unlistenEnd();
          unlistenError();
          reject(new Error(event.payload.error));
        }
      );

      if (cancelled) {
        unlistenChunk();
        unlistenEnd();
        unlistenError();
        reject(new Error("Cancelled"));
        return;
      }

      await invoke("call_llm_api_streaming", {
        streamId,
        provider,
        apiUrl,
        payload,
      });
    } catch (err: any) {
      reject(new Error(err?.message || String(err)));
    }
  });

  return {
    streamId,
    result,
    cancel: () => { cancelled = true; },
  };
}

/* ==========================================================================
   Agent System Prompts
   ========================================================================== */

export const PLANNER_SYSTEM_PROMPT = `
You are the PLANNER_AGENT for Orbit Code. Your task is to analyze user coding requests and formulate a structured implementation plan.
You must output a single JSON object matching this schema. Do NOT wrap it in HTML/Markdown formatting except code block if necessary.

Schema:
{
  "title": "Short descriptive title of the plan",
  "references": ["files/that/are/relevant.ts"],
  "goals": ["Main goal 1", "Main goal 2"],
  "tasks": [
    {
      "id": "unique-task-id-1",
      "title": "Task step title",
      "details": "Clear details of what changes are required",
      "verification": ["commands", "to", "run"],
      "filesHint": ["files/to/modify.ts"]
    }
  ]
}
`;

export const CODER_SYSTEM_PROMPT = `
You are the CODER_AGENT for Orbit Code. Your job is to modify code file.
You will be provided with the current file path, current file content, and the task detail.
You must output the COMPLETE new content of the file. Do NOT explain your changes. Do NOT wrap code in markdown tags like \`\`\`typescript. Just return the raw code lines.
`;
