import { Brain, Hammer, Plus, Route } from "lucide-react";
import type { RunControlsState } from "../state/useRunControls";
import type { AppCopy } from "../i18n/copy";
import type { ReasoningEffort, WorkbenchMode } from "../domain/types";
import { SelectMenu } from "../ui/primitives";

interface RunControlBarProps {
  copy: AppCopy;
  controls: RunControlsState;
  onOpenSettings?: (section?: string) => void;
}

const modes: WorkbenchMode[] = ["plan", "build"];

function formatContextTokens(tokens?: number) {
  if (!tokens) return "";
  if (tokens >= 1_000_000) return `${tokens / 1_000_000}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

export function RunControlBar({ copy, controls, onOpenSettings }: RunControlBarProps) {
  return (
    <div className="run-control-bar compact" aria-label={copy.runControls.title}>
      <div className="run-mode-switch" role="group" aria-label={copy.runControls.mode}>
        {modes.map((mode) => (
          <button
            key={mode}
            type="button"
            className={controls.mode === mode ? "active" : ""}
            onClick={() => controls.setMode(mode)}
          >
            {mode === "plan" ? <Route size={14} /> : <Hammer size={14} />}
            <span>{copy.runControls[mode]}</span>
          </button>
        ))}
      </div>

      {controls.modelOptions.length > 0 ? (
        <SelectMenu
          size="compact"
          value={controls.selectedModelId}
          ariaLabel={copy.runControls.model}
          onChange={controls.setModelId}
          options={controls.modelOptions.map((option) => ({
            value: option.id,
            label: `${option.label}${option.capability?.maxContextTokens ? ` · ${formatContextTokens(option.capability.maxContextTokens)}` : ""}`,
            description: option.capability?.buildSupported === false ? copy.runControls.unsupported : undefined,
          }))}
        />
      ) : (
        <button type="button" className="add-model-inline" onClick={() => onOpenSettings?.("models")}>
          <Plus size={14} />
          {copy.runControls.addModel}
        </button>
      )}

      {controls.availableReasoningEfforts.length > 0 ? (
        <SelectMenu
          size="compact"
          icon={<Brain size={14} />}
          value={controls.selection.reasoningEffort}
          ariaLabel={copy.runControls.reasoning}
          onChange={(value) => controls.setReasoningEffort(value as ReasoningEffort)}
          options={controls.availableReasoningEfforts.map((effort) => ({
            value: effort,
            label: effort === "auto" ? copy.runControls.autoReasoning : copy.runControls[effort],
          }))}
        />
      ) : null}

      {controls.selectedCapability?.maxContextTokens ? (
        <span className="run-context-chip">{formatContextTokens(controls.selectedCapability.maxContextTokens)}</span>
      ) : null}

      {controls.mode === "build" && controls.selectedModelId && controls.missingCredential ? (
        <span className="run-unsupported-chip">{copy.settingsModal.vaultLocked}</span>
      ) : null}

      {controls.mode === "build" && controls.selectedModelId && !controls.buildSupported ? (
        <span className="run-unsupported-chip">{copy.runControls.unsupported}</span>
      ) : null}
    </div>
  );
}
