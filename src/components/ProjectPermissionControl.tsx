import { Check, ChevronDown, Shield } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PermissionPreset } from "../domain/types";
import type { AppCopy } from "../i18n/copy";
import {
  getPermissionControlAction,
  getPermissionPresetLabel,
  permissionPresetOrder,
} from "./projectPermissionControlModel";

interface ProjectPermissionControlProps {
  copy: AppCopy;
  workspaceRoot?: string;
  value: PermissionPreset;
  onChange?: (preset: PermissionPreset) => void;
  onOpenSettings?: (section?: string) => void;
}

export function ProjectPermissionControl({
  copy,
  workspaceRoot,
  value,
  onChange,
  onOpenSettings,
}: ProjectPermissionControlProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const label = getPermissionPresetLabel(copy, value);
  const hasWorkspace = getPermissionControlAction(workspaceRoot) === "openMenu";

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function handleClick() {
    if (!hasWorkspace) {
      onOpenSettings?.("security");
      return;
    }
    setOpen((current) => !current);
  }

  return (
    <div ref={rootRef} className="project-permission-control">
      <button
        type="button"
        className={`project-permission-chip ${open ? "active" : ""}`}
        aria-haspopup={hasWorkspace ? "menu" : undefined}
        aria-expanded={hasWorkspace ? open : undefined}
        aria-label={copy.security.projectPermission}
        title={workspaceRoot || copy.workbench.noWorkspace}
        onClick={handleClick}
      >
        <Shield size={14} />
        <span>{label}</span>
        <ChevronDown size={13} />
      </button>
      {open ? (
        <div className="project-permission-menu" role="menu">
          <strong>{copy.security.projectPermission}</strong>
          {permissionPresetOrder.map((preset) => (
            <button
              key={preset}
              type="button"
              role="menuitemradio"
              aria-checked={value === preset}
              className={value === preset ? "active" : ""}
              onClick={() => {
                onChange?.(preset);
                setOpen(false);
              }}
            >
              <span>{getPermissionPresetLabel(copy, preset)}</span>
              {value === preset ? <Check size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
