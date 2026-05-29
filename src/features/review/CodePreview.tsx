import { lazy, Suspense } from "react";
import { Clipboard, Copy, FileCode2, X } from "lucide-react";
import { createFileActionTarget } from "../../domain/fileActions";
import type { AppCopy } from "../../i18n/copy";
import type { FilePreviewState } from "../../domain/filePreview";
import type { Theme } from "../../domain/types";
import { FileActionMenu } from "../files/FileActionMenu";

const MonacoEditor = lazy(async () => {
  const module = await import("@monaco-editor/react");
  return { default: module.default };
});

interface CodePreviewProps {
  copy: AppCopy;
  preview: FilePreviewState;
  workspacePath?: string;
  theme: Theme;
  onClose: () => void;
}

function fileName(path?: string) {
  return path?.split(/[\\/]/).pop() || "";
}

function safePreview(content: string) {
  const maxChars = 220_000;
  const lines = content.split("\n").slice(0, 5000);
  const joined = lines.join("\n");
  return joined.length > maxChars ? joined.slice(0, maxChars) : joined;
}

async function copyText(text?: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard access can be blocked in tests or hardened desktop contexts.
  }
}

export function CodePreview({ copy, preview, workspacePath, theme, onClose }: CodePreviewProps) {
  const editorTheme = theme === "dark" ? "vs-dark" : "vs";

  if (!preview.path) {
    return null;
  }
  const target = createFileActionTarget({ workspacePath, path: preview.path, sourceSurface: "review" });

  return (
    <section className="dock-file-preview monaco-readonly-preview" data-testid="monaco-readonly-preview">
      <header className="code-preview-header">
        <div className="code-preview-title">
          <FileCode2 size={15} />
          <div>
            <strong>{fileName(preview.path)}</strong>
            <FileActionMenu copy={copy} target={target}>
              <small className="file-action-path-label">{preview.path}</small>
            </FileActionMenu>
          </div>
        </div>
        <div className="code-preview-actions">
          <button type="button" onClick={() => void copyText(preview.path)} title={copy.workbench.copyPath}>
            <Copy size={14} />
            <span>{copy.workbench.copyPath}</span>
          </button>
          <button type="button" onClick={() => void copyText(preview.content)} title={copy.workbench.copyContent}>
            <Clipboard size={14} />
            <span>{copy.workbench.copyContent}</span>
          </button>
          <button type="button" onClick={onClose} title={copy.outputPanel.closePreview} aria-label={copy.outputPanel.closePreview}>
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="code-preview-meta">
        <span>{preview.language || "plaintext"}</span>
        <span>{preview.lineCount} {copy.workbench.lines}</span>
        <span>{copy.workbench.readonlyPreview}</span>
      </div>

      {preview.loading ? (
        <div className="code-preview-loading">{copy.loading}</div>
      ) : preview.largeFileMode ? (
        <div className="large-file-preview">
          <p>{copy.workbench.largeFilePreview}</p>
          <pre><code>{safePreview(preview.content || "")}</code></pre>
        </div>
      ) : (
        <div className="monaco-preview-shell">
          <Suspense fallback={<div className="code-preview-loading">{copy.loading}</div>}>
            <MonacoEditor
              height="100%"
              language={preview.language || "plaintext"}
              value={preview.content || ""}
              theme={editorTheme}
              options={{
                readOnly: true,
                domReadOnly: true,
                minimap: { enabled: false },
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                automaticLayout: true,
                fontSize: 12,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                wordWrap: "off",
                renderLineHighlight: "none",
                contextmenu: true,
              }}
            />
          </Suspense>
        </div>
      )}
    </section>
  );
}
