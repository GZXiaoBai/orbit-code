import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Code2, Copy, ExternalLink, FolderOpen } from "lucide-react";
import type { FileActionTarget, FileOpenAction } from "../../domain/fileActions";
import type { AppCopy } from "../../i18n/copy";
import { copyFileActionPath, openFileAction } from "../../runtime/fileActionRuntime";

interface FileActionMenuProps {
  copy: AppCopy;
  target: FileActionTarget | null;
  children: ReactNode;
  className?: string;
  openOnClick?: boolean;
}

export function FileActionMenu({
  copy,
  target,
  children,
  className,
  openOnClick = true,
}: FileActionMenuProps) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const targetNode = event.target as Node;
      if (triggerRef.current?.contains(targetNode) || menuRef.current?.contains(targetNode)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!target) return <>{children}</>;

  const openAt = (x: number, y: number) => {
    setPosition({
      x: Math.min(x, window.innerWidth - 280),
      y: Math.min(y, window.innerHeight - 210),
    });
    setMessage("");
    setOpen(true);
  };

  const run = async (action: FileOpenAction | "copy") => {
    try {
      if (action === "copy") {
        await copyFileActionPath(target);
        setMessage(copy.workbench.pathCopied);
      } else {
        await openFileAction(target, action);
        setOpen(false);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const onTriggerClick = (event: MouseEvent<HTMLSpanElement>) => {
    if (!openOnClick) return;
    event.preventDefault();
    event.stopPropagation();
    openAt(event.clientX, event.clientY);
  };

  const onContextMenu = (event: MouseEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    openAt(event.clientX, event.clientY);
  };

  return (
    <span
      ref={triggerRef}
      className={className || "file-action-trigger"}
      onClick={onTriggerClick}
      onContextMenu={onContextMenu}
      data-file-action-target={target.relativePath}
    >
      {children}
      {open ? createPortal(
        <div
          ref={menuRef}
          className="file-action-menu"
          style={{ left: position.x, top: position.y }}
          role="menu"
        >
          <button type="button" role="menuitem" onClick={() => void run("vscode")}>
            <Code2 size={16} />
            <span>{copy.workbench.openInVSCode}</span>
          </button>
          <div className="file-action-submenu">
            <button type="button" role="menuitem" aria-haspopup="menu">
              <ExternalLink size={16} />
              <span>{copy.workbench.openWith}</span>
              <ChevronRight size={16} />
            </button>
            <div className="file-action-submenu-panel" role="menu">
              <button type="button" role="menuitem" onClick={() => void run("vscode")}>{copy.workbench.openInVSCode}</button>
              <button type="button" role="menuitem" onClick={() => void run("cursor")}>{copy.workbench.openInCursor}</button>
              <button type="button" role="menuitem" onClick={() => void run("default")}>{copy.workbench.openInDefaultApp}</button>
            </div>
          </div>
          <button type="button" role="menuitem" onClick={() => void run("copy")}>
            <Copy size={16} />
            <span>{copy.workbench.copyPath}</span>
          </button>
          <button type="button" role="menuitem" onClick={() => void run("reveal")}>
            <FolderOpen size={16} />
            <span>{copy.workbench.openInFinder}</span>
          </button>
          {message ? <p className="file-action-message">{message}</p> : null}
        </div>,
        document.body,
      ) : null}
    </span>
  );
}
