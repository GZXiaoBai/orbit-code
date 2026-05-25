import { Archive, Copy, ExternalLink, PanelRight, Pencil, Pin, Undo2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { AppCopy } from "../../i18n/copy";

interface ThreadActionsMenuProps {
  copy: AppCopy;
  pinned?: boolean;
  archived?: boolean;
  reviewDockVisible: boolean;
  onClose: () => void;
  onPin: () => void;
  onRename: () => void;
  onArchive: () => void;
  onToggleReviewDock: () => void;
  onCopySummary: () => void;
  onOpenNewWindow: () => void;
}

export function ThreadActionsMenu({
  copy,
  pinned,
  archived,
  reviewDockVisible,
  onClose,
  onPin,
  onRename,
  onArchive,
  onToggleReviewDock,
  onCopySummary,
  onOpenNewWindow,
}: ThreadActionsMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (menuRef.current?.contains(target as Node)) return;
      if (target?.closest("[data-thread-menu-trigger='true']")) return;
      onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("pointerdown", closeOnOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  const run = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <div ref={menuRef} className="thread-actions-menu" role="menu">
      <button type="button" role="menuitem" onClick={() => run(onPin)}>
        <Pin size={16} />
        <span>{pinned ? copy.workbench.unpinThread : copy.workbench.pinThread}</span>
      </button>
      <button type="button" role="menuitem" onClick={() => run(onRename)}>
        <Pencil size={16} />
        <span>{copy.workbench.renameThread}</span>
      </button>
      <button type="button" role="menuitem" onClick={() => run(onArchive)}>
        {archived ? <Undo2 size={16} /> : <Archive size={16} />}
        <span>{archived ? copy.workbench.restoreThread : copy.workbench.archiveThread}</span>
      </button>
      <hr />
      <button type="button" role="menuitem" onClick={() => run(onToggleReviewDock)}>
        <PanelRight size={16} />
        <span>{reviewDockVisible ? copy.workbench.hideReviewDock : copy.workbench.showReviewDock}</span>
      </button>
      <button type="button" role="menuitem" onClick={() => run(onCopySummary)}>
        <Copy size={16} />
        <span>{copy.workbench.copyThreadSummary}</span>
      </button>
      <button type="button" role="menuitem" onClick={() => run(onOpenNewWindow)}>
        <ExternalLink size={16} />
        <span>{copy.workbench.openThreadInNewWindow}</span>
      </button>
    </div>
  );
}
