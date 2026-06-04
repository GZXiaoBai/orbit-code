import { describe, expect, it } from "vitest";
import { ORBIT_CODE_VAULT_PREFIX } from "../storage/keychain";
import { appendProviderPath, fallbackCapability, isOpenAICompatibleProvider, normalizeModelInfo } from "../providers/providerAdapters";
import type { LLMProvider } from "../services/llmService";

describe("provider persistence and adapters", () => {
  it("uses Orbit Code encrypted credential vault keys", () => {
    expect(ORBIT_CODE_VAULT_PREFIX).toBe("credential.vault.");
  });

  it("treats newly added providers as OpenAI-compatible where appropriate", () => {
    expect(isOpenAICompatibleProvider("openrouter")).toBe(true);
    expect(isOpenAICompatibleProvider("siliconflow")).toBe(true);
    expect(isOpenAICompatibleProvider("together")).toBe(true);
    expect(isOpenAICompatibleProvider("fireworks")).toBe(true);
    expect(isOpenAICompatibleProvider("cerebras")).toBe(true);
    expect(isOpenAICompatibleProvider("nvidia")).toBe(true);
    expect(isOpenAICompatibleProvider("azure-openai")).toBe(true);
    expect(isOpenAICompatibleProvider("custom-openai")).toBe(true);
    expect(isOpenAICompatibleProvider("ollama")).toBe(false);
    expect(isOpenAICompatibleProvider("anthropic")).toBe(false);
  });

  it("keeps Ollama as a first-class legacy LLM provider without marking it OpenAI-compatible", () => {
    const provider: LLMProvider = "ollama";
    const capability = fallbackCapability(provider, "qwen3-coder");

    expect(capability.local).toBe(true);
    expect(capability.buildSupported).toBe(false);
  });

  it("normalizes pasted provider endpoints before appending target paths", () => {
    expect(appendProviderPath("https://gateway.example/v1/chat/completions", "/models"))
      .toBe("https://gateway.example/v1/models");
    expect(appendProviderPath("https://gateway.example/v1/models", "/chat/completions"))
      .toBe("https://gateway.example/v1/chat/completions");
    expect(appendProviderPath("https://gateway.example/v1/responses", "/chat/completions"))
      .toBe("https://gateway.example/v1/chat/completions");
    expect(appendProviderPath("http://127.0.0.1:11434/api/chat", "/api/tags"))
      .toBe("http://127.0.0.1:11434/api/tags");
  });

  it("normalizes OpenRouter model metadata with API context length", () => {
    const info = normalizeModelInfo("openrouter", {
      id: "openai/gpt-5.1-codex",
      context_length: 400_000,
      max_output_tokens: 32_768,
      supported_parameters: ["tools"],
    });

    expect(info?.capability.maxContextTokens).toBe(400_000);
    expect(info?.capability.maxOutputTokens).toBe(32_768);
    expect(info?.capability.toolCalls).toBe(true);
    expect(info?.capability.capabilitySource).toBe("api");
  });

  it("normalizes Together AI model metadata", () => {
    const info = normalizeModelInfo("together", {
      id: "Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8",
      context_length: 131_072,
      supported_parameters: ["tools"],
    });

    expect(info?.capability.maxContextTokens).toBe(131_072);
    expect(info?.capability.toolCalls).toBe(true);
    expect(info?.capability.capabilitySource).toBe("api");
  });

  it("normalizes Fireworks AI model metadata", () => {
    const info = normalizeModelInfo("fireworks", {
      id: "accounts/fireworks/models/qwen3-coder-480b-a35b-instruct",
      context_length: 262_144,
      supported_parameters: ["tools", "tool_choice"],
    });

    expect(info?.capability.maxContextTokens).toBe(262_144);
    expect(info?.capability.toolCalls).toBe(true);
    expect(info?.capability.capabilitySource).toBe("api");
  });

  it("normalizes Cerebras model metadata", () => {
    const info = normalizeModelInfo("cerebras", {
      id: "gpt-oss-120b",
      limits: {
        max_context_length: 131_072,
        max_completion_tokens: 40_960,
      },
      capabilities: {
        tools: true,
      },
    });

    expect(info?.capability.maxContextTokens).toBe(131_072);
    expect(info?.capability.maxOutputTokens).toBe(40_960);
    expect(info?.capability.toolCalls).toBe(true);
    expect(info?.capability.capabilitySource).toBe("api");
  });

  it("normalizes NVIDIA NIM model metadata", () => {
    const info = normalizeModelInfo("nvidia", {
      id: "qwen/qwen3-coder-480b-a35b-instruct",
      context_length: 262_144,
      supported_parameters: ["tools", "tool_choice"],
    });

    expect(info?.capability.maxContextTokens).toBe(262_144);
    expect(info?.capability.toolCalls).toBe(true);
    expect(info?.capability.capabilitySource).toBe("api");
  });

  it("normalizes Azure OpenAI deployment metadata", () => {
    const info = normalizeModelInfo("azure-openai", {
      id: "gpt-5-codex-prod",
      max_context_tokens: 400_000,
      max_completion_tokens: 32_768,
      supported_parameters: ["tools", "response_format"],
    });

    expect(info?.capability.maxContextTokens).toBe(400_000);
    expect(info?.capability.maxOutputTokens).toBe(32_768);
    expect(info?.capability.toolCalls).toBe(true);
    expect(info?.capability.capabilitySource).toBe("api");
  });

  it("normalizes provider-specific model metadata variants", () => {
    const anthropic = normalizeModelInfo("anthropic", {
      id: "claude-sonnet-4-5",
      display_name: "Claude Sonnet 4.5",
      input_token_limit: "200000",
      outputTokenLimit: 64_000,
    });
    const google = normalizeModelInfo("google", {
      name: "models/gemini-2.5-pro",
      inputTokenLimit: 1_048_576,
      outputTokenLimit: 65_536,
    });
    const zhipu = normalizeModelInfo("zhipu", {
      model: "glm-4.6",
      contextWindow: "128000",
      capabilities: { function_calling: true },
    });

    expect(anthropic?.id).toBe("claude-sonnet-4-5");
    expect(anthropic?.label).toBe("Claude Sonnet 4.5");
    expect(anthropic?.capability.maxContextTokens).toBe(200_000);
    expect(anthropic?.capability.maxOutputTokens).toBe(64_000);
    expect(google?.id).toBe("gemini-2.5-pro");
    expect(google?.capability.maxContextTokens).toBe(1_048_576);
    expect(google?.capability.maxOutputTokens).toBe(65_536);
    expect(zhipu?.capability.maxContextTokens).toBe(128_000);
    expect(zhipu?.capability.toolCalls).toBe(true);
  });

  it("falls back to official capability table for domestic providers", () => {
    const capability = fallbackCapability("kimi", "kimi-k2-thinking-turbo");

    expect(capability.maxContextTokens).toBeGreaterThanOrEqual(128_000);
    expect(capability.reasoningLevels).toContain("deep");
  });
});
