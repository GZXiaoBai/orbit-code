import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProviderBuildGate } from "../domain/codex";
import type { ReasoningEffort, RunModelSelection, WorkbenchMode } from "../domain/types";
import type { ProviderSettings } from "./useSession";
import { buildProviderBuildGate, buildRunModelOptions, inferReasoningEfforts, resolveModelSelection, type RunModelOption } from "./modelSettings";
import { findProvider } from "../providers/providerRegistry";

const STORAGE_KEY = "agent-gui.run-controls.v1";
const reasoningEfforts: ReasoningEffort[] = ["auto", "fast", "balanced", "deep", "high", "max"];

export interface RunControlsState {
  mode: WorkbenchMode;
  selection: RunModelSelection;
  modelOptions: RunModelOption[];
  availableReasoningEfforts: ReasoningEffort[];
  selectedModelId: string;
  providerLabel: string;
  hasModelAccess: boolean;
  missingCredential: boolean;
  buildSupported: boolean;
  buildGate: ProviderBuildGate;
  selectedCapability: RunModelOption["capability"] | null;
  setMode: (mode: WorkbenchMode) => void;
  setModelId: (modelId: string) => void;
  setReasoningEffort: (effort: ReasoningEffort) => void;
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && reasoningEfforts.includes(value as ReasoningEffort);
}

export function defaultModelForProvider(
  providerId: string,
  settings: ProviderSettings,
  apiKeys: Record<string, string> = {},
  savedCredentialProviders: string[] = [],
): string {
  return resolveModelSelection(settings, apiKeys, { providerId }, savedCredentialProviders)?.model || "";
}

function createDefaultState(
  settings: ProviderSettings,
  apiKeys: Record<string, string>,
  savedCredentialProviders: string[],
): Pick<RunControlsState, "mode" | "selection"> {
  const selected = resolveModelSelection(settings, apiKeys, { providerId: settings.activeProviderId }, savedCredentialProviders);
  return {
    mode: "plan",
    selection: {
      providerId: selected?.providerId || settings.activeProviderId,
      model: selected?.model || "",
      reasoningEffort: selected?.capability?.reasoningLevels[0] || "auto",
    },
  };
}

function loadStoredState(
  settings: ProviderSettings,
  apiKeys: Record<string, string>,
  savedCredentialProviders: string[],
): Pick<RunControlsState, "mode" | "selection"> {
  const fallback = createDefaultState(settings, apiKeys, savedCredentialProviders);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Pick<RunControlsState, "mode" | "selection">>;
    const selected = resolveModelSelection(settings, apiKeys, parsed.selection, savedCredentialProviders);
    const reasoningEffort = isReasoningEffort(parsed.selection?.reasoningEffort)
      ? parsed.selection.reasoningEffort
      : selected?.capability?.reasoningLevels[0] || "auto";
    return {
      mode: parsed.mode === "build" ? "build" : "plan",
      selection: {
        providerId: selected?.providerId || fallback.selection.providerId,
        model: selected?.model || "",
        reasoningEffort,
      },
    };
  } catch {
    return fallback;
  }
}

export function useRunControls(
  settings: ProviderSettings,
  apiKeys: Record<string, string>,
  savedCredentialProviders: string[] = [],
): RunControlsState {
  const initial = useMemo(() => loadStoredState(settings, apiKeys, savedCredentialProviders), []);
  const [mode, setModeState] = useState<WorkbenchMode>(initial.mode);
  const [selection, setSelection] = useState<RunModelSelection>(initial.selection);

  const modelOptions = useMemo(() => buildRunModelOptions(settings, apiKeys, savedCredentialProviders), [settings, apiKeys, savedCredentialProviders]);
  const activeProviderMatch = modelOptions.find((option) => option.providerId === settings.activeProviderId);
  const selectedOption = useMemo(() => {
    if (modelOptions.length === 0) return null;
    if (selection.providerId === "fixture" && settings.activeProviderId && settings.activeProviderId !== "fixture" && activeProviderMatch) {
      return activeProviderMatch;
    }
    return modelOptions.find((option) => option.providerId === selection.providerId && option.model === selection.model)
      || modelOptions.find((option) => option.providerId === selection.providerId)
      || activeProviderMatch
      || modelOptions[0];
  }, [activeProviderMatch, modelOptions, selection.model, selection.providerId, settings.activeProviderId]);
  const provider = selectedOption ? findProvider(selectedOption.providerId) : null;
  const selectedModelId = selectedOption?.id || "";
  const availableReasoningEfforts = useMemo(
    () => selectedOption ? (selectedOption.capability?.reasoningLevels?.length ? selectedOption.capability.reasoningLevels : inferReasoningEfforts(selectedOption.providerId, selectedOption.model)) : [],
    [selectedOption],
  );
  const hasSavedCredential = Boolean(provider && savedCredentialProviders.includes(provider.id));
  const missingCredential = Boolean(provider && !provider.capabilities.local && !apiKeys[provider.id]);
  const hasModelAccess = Boolean(provider && (provider.capabilities.local || apiKeys[provider.id] || hasSavedCredential));
  const buildGate = useMemo(() => buildProviderBuildGate({
    providerId: selectedOption?.providerId || selection.providerId,
    model: selectedOption?.model || selection.model,
    settings,
    apiKeys,
    savedCredentialProviders,
  }), [apiKeys, savedCredentialProviders, selectedOption?.model, selectedOption?.providerId, selection.model, selection.providerId, settings]);
  const buildSupported = buildGate.canBuild;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, selection }));
  }, [mode, selection]);

  useEffect(() => {
    setSelection((prev) => {
      const selected = modelOptions.find((option) => option.providerId === prev.providerId && option.model === prev.model)
        || modelOptions.find((option) => option.providerId === prev.providerId)
        || modelOptions.find((option) => option.providerId === settings.activeProviderId)
        || modelOptions[0];
      if (selected && selected.providerId === prev.providerId && selected.model === prev.model) return prev;
      return {
        providerId: selected?.providerId || settings.activeProviderId,
        model: selected?.model || "",
        reasoningEffort: prev.reasoningEffort,
      };
    });
  }, [modelOptions, settings.activeProviderId]);

  useEffect(() => {
    setSelection((prev) => {
      if (availableReasoningEfforts.length === 0 || availableReasoningEfforts.includes(prev.reasoningEffort)) return prev;
      return { ...prev, reasoningEffort: availableReasoningEfforts[0] };
    });
  }, [availableReasoningEfforts]);

  const setMode = useCallback((nextMode: WorkbenchMode) => {
    setModeState(nextMode);
  }, []);

  const setModelId = useCallback((modelId: string) => {
    const option = modelOptions.find((item) => item.id === modelId);
    if (!option) return;
    setSelection((prev) => ({
      providerId: option.providerId,
      model: option.model,
      reasoningEffort: prev.reasoningEffort,
    }));
  }, [modelOptions]);

  const setReasoningEffort = useCallback((reasoningEffort: ReasoningEffort) => {
    setSelection((prev) => ({ ...prev, reasoningEffort }));
  }, []);

  return {
    mode,
    selection,
    modelOptions,
    availableReasoningEfforts,
    selectedModelId,
    providerLabel: selectedOption?.providerLabel || "",
    selectedCapability: selectedOption?.capability || null,
    hasModelAccess,
    missingCredential,
    buildSupported,
    buildGate,
    setMode,
    setModelId,
    setReasoningEffort,
  };
}
