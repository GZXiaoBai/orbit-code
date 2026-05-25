import {
  ArrowUp,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Plus,
  X,
} from "lucide-react";
import { useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from "react";
import type { AppCopy } from "../i18n/copy";
import type { RunControlsState } from "../state/useRunControls";
import { RunControlBar } from "./RunControlBar";
import type { ComposerAttachment, PermissionPreset } from "../domain/types";
import { ProjectPermissionControl } from "./ProjectPermissionControl";
import { attachmentFromFile, classifyPastedText, formatAttachmentContext } from "../domain/composerAttachments";

interface ComposerProps {
  copy: AppCopy;
  onPlanImport: (source: string, fileName?: string) => Promise<boolean> | boolean;
  runControls?: RunControlsState;
  onOpenSettings?: (section?: string) => void;
  workspaceRoot?: string;
  projectPermissionPreset?: PermissionPreset;
  onProjectPermissionChange?: (preset: PermissionPreset) => void;
}

export function Composer({
  copy,
  onPlanImport,
  runControls,
  onOpenSettings,
  workspaceRoot,
  projectPermissionPreset = "askBeforeAction",
  onProjectPermissionChange,
}: ComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [dragActive, setDragActive] = useState(false);

  async function handleFileImport(file: File) {
    const attachment = await attachmentFromFile(file, "file-picker");
    if (attachment.kind === "plan" && attachment.content) {
      setAttachments((prev) => [...prev, attachment]);
      return;
    }
    setAttachments((prev) => [...prev, attachment]);
  }

  async function submitDraft() {
    if (!draft.trim() && attachments.length === 0) return;
    const source = `${draft.trim()}${formatAttachmentContext(attachments)}`;
    const imported = await onPlanImport(source, "composer-input.md");
    if (imported) {
      setDraft("");
      setAttachments([]);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitDraft();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      void submitDraft();
      return;
    }
    event.preventDefault();
    void submitDraft();
  }

  function addAttachments(next: ComposerAttachment[]) {
    if (next.length === 0) return;
    setAttachments((prev) => [...prev, ...next]);
  }

  async function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files || []);
    if (files.length > 0) {
      event.preventDefault();
      addAttachments(await Promise.all(files.map((file) => attachmentFromFile(file, "paste"))));
      return;
    }

    const text = event.clipboardData.getData("text/plain");
    const classified = classifyPastedText(text);
    if (classified.action === "attach" && classified.attachment) {
      event.preventDefault();
      addAttachments([classified.attachment]);
    }
  }

  async function handleDrop(event: DragEvent<HTMLFormElement>) {
    event.preventDefault();
    setDragActive(false);
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length > 0) {
      addAttachments(await Promise.all(files.map((file) => attachmentFromFile(file, "drop"))));
    }
  }

  function attachmentIcon(kind: ComposerAttachment["kind"]) {
    if (kind === "image") return <ImageIcon size={13} />;
    if (kind === "pdf" || kind === "plan" || kind === "code" || kind === "text") return <FileText size={13} />;
    return <Paperclip size={13} />;
  }

  async function importPlanAttachment(attachment: ComposerAttachment) {
    if (!attachment.content) return;
    const imported = await onPlanImport(attachment.content, attachment.name);
    if (imported) setAttachments((prev) => prev.filter((item) => item.id !== attachment.id));
  }

  return (
    <form
      className={`composer ${dragActive ? "drag-active" : ""}`}
      onSubmit={handleSubmit}
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={(event) => {
        const related = event.relatedTarget as Node | null;
        if (!related || !event.currentTarget.contains(related)) setDragActive(false);
      }}
      onDrop={(event) => void handleDrop(event)}
    >
      <div className="composer-input-shell">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          onPaste={(event) => void handlePaste(event)}
          placeholder={copy.composer.placeholder}
        />
        <button className="send-button" type="submit" aria-label="Send">
          <ArrowUp size={18} />
        </button>
      </div>
      {attachments.length > 0 ? (
        <div className="composer-attachments" aria-label={copy.composer.attachments}>
          {attachments.map((attachment) => (
            <span key={attachment.id} className={`composer-attachment composer-attachment-${attachment.kind}`}>
              {attachmentIcon(attachment.kind)}
              <button
                type="button"
                className="composer-attachment-name"
                title={attachment.name}
                onClick={() => {
                  if (attachment.content) void navigator.clipboard?.writeText(attachment.name).catch(() => undefined);
                }}
              >
                {attachment.name}
              </button>
              {attachment.kind === "plan" && attachment.content ? (
                <button type="button" className="composer-attachment-action" onClick={() => void importPlanAttachment(attachment)}>
                  {copy.composer.importAttachmentPlan}
                </button>
              ) : null}
              <button
                type="button"
                className="composer-attachment-remove"
                aria-label={copy.composer.removeAttachment}
                onClick={() => setAttachments((prev) => prev.filter((item) => item.id !== attachment.id))}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="composer-footer">
        <input
          ref={fileInputRef}
          type="file"
          accept=".yaml,.yml,.md,.markdown,text/yaml,text/markdown,text/plain"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void handleFileImport(file);
            event.currentTarget.value = "";
          }}
        />
        <button
          className="icon-button"
          type="button"
          aria-label={copy.importPlan}
          title={copy.importPlan}
          onClick={() => fileInputRef.current?.click()}
        >
          <Plus size={20} />
        </button>
        <ProjectPermissionControl
          copy={copy}
          workspaceRoot={workspaceRoot}
          value={projectPermissionPreset}
          onChange={onProjectPermissionChange}
          onOpenSettings={onOpenSettings}
        />
        {runControls ? <RunControlBar copy={copy} controls={runControls} onOpenSettings={onOpenSettings} /> : null}
      </div>
    </form>
  );
}
