import { useState, useMemo } from "react";
import { Check, Columns, FileCode, AlertCircle } from "lucide-react";
import { createFileActionTarget } from "../domain/fileActions";
import { FileActionMenu } from "../features/files/FileActionMenu";
import type { AppCopy } from "../i18n/copy";
import { computeLineDiff, type DiffChange } from "../utils/diff";

interface DiffPatch {
  path: string;
  oldContent: string;
  newContent: string;
  applied: boolean;
  sandboxStatus?: "idle" | "sandboxing" | "sandboxed" | "failed";
  applyStatus?: "proposed" | "approved" | "applied" | "failed";
  hasConflict?: boolean;
  conflictContent?: string;
  conflictResolved?: boolean;
}

interface DiffViewerProps {
  copy: AppCopy;
  patches: DiffPatch[];
  onApply: () => Promise<void>;
  workspacePath?: string;
  eventId?: string;
  onUpdatePatch?: (eventId: string, path: string, updates: Partial<DiffPatch>) => void;
}

interface ConflictBlock {
  id: string;
  type: "conflict";
  ours: string;
  theirs: string;
}

interface NormalBlock {
  type: "normal";
  content: string;
}

type ParsedBlock = NormalBlock | ConflictBlock;

interface ContextRow {
  kind: "context";
  count: number;
}

interface ChangeRow {
  kind: "change";
  change: DiffChange;
}

type InlineRow = ContextRow | ChangeRow;

interface SplitPairRow {
  kind: "pair";
  left?: DiffChange;
  right?: DiffChange;
  normal?: boolean;
}

type SplitRow = ContextRow | SplitPairRow;

const KEYWORD_RE = /\b(?:await|async|break|case|catch|class|const|continue|default|describe|else|enum|export|extends|false|finally|for|from|function|if|import|interface|it|let|new|null|return|switch|test|throw|true|try|type|undefined|var|while|expect)\b/g;
const TOKEN_RE = /(\/\/.*$|\/\*.*?\*\/|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`|\b(?:await|async|break|case|catch|class|const|continue|default|describe|else|enum|export|extends|false|finally|for|from|function|if|import|interface|it|let|new|null|return|switch|test|throw|true|try|type|undefined|var|while|expect)\b|\b\d+(?:\.\d+)?\b|[{}()[\].,:;=+\-*/<>!?&|]+)/g;

function parseConflicts(content: string): ParsedBlock[] {
  const lines = content.split("\n");
  const blocks: ParsedBlock[] = [];
  let currentNormal: string[] = [];
  let inConflict = false;
  let currentOurs: string[] = [];
  let currentTheirs: string[] = [];
  let conflictMode: "ours" | "theirs" = "ours";
  let conflictId = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("<<<<<<<")) {
      if (currentNormal.length > 0) {
        blocks.push({ type: "normal", content: currentNormal.join("\n") });
        currentNormal = [];
      }
      inConflict = true;
      conflictMode = "ours";
      currentOurs = [];
      currentTheirs = [];
    } else if (line.startsWith("=======")) {
      if (inConflict) {
        conflictMode = "theirs";
      } else {
        currentNormal.push(line);
      }
    } else if (line.startsWith(">>>>>>>")) {
      if (inConflict) {
        blocks.push({
          id: `conflict-${conflictId++}`,
          type: "conflict",
          ours: currentOurs.join("\n"),
          theirs: currentTheirs.join("\n"),
        });
        inConflict = false;
      } else {
        currentNormal.push(line);
      }
    } else {
      if (inConflict) {
        if (conflictMode === "ours") {
          currentOurs.push(line);
        } else {
          currentTheirs.push(line);
        }
      } else {
        currentNormal.push(line);
      }
    }
  }

  if (currentNormal.length > 0) {
    blocks.push({ type: "normal", content: currentNormal.join("\n") });
  }

  return blocks;
}

function countPatchStats(patch: DiffPatch | undefined) {
  if (!patch || patch.hasConflict) return { additions: 0, deletions: 0 };
  return computeLineDiff(patch.oldContent, patch.newContent).reduce(
    (acc, change) => {
      if (change.type === "added") acc.additions += 1;
      if (change.type === "removed") acc.deletions += 1;
      return acc;
    },
    { additions: 0, deletions: 0 },
  );
}

function compactInlineRows(changes: DiffChange[], context = 3, minCollapse = 10): InlineRow[] {
  const rows: InlineRow[] = [];
  let index = 0;

  while (index < changes.length) {
    const change = changes[index];
    if (change.type !== "normal") {
      rows.push({ kind: "change", change });
      index += 1;
      continue;
    }

    const start = index;
    while (index < changes.length && changes[index].type === "normal") {
      index += 1;
    }

    const block = changes.slice(start, index);
    if (block.length > minCollapse) {
      block.slice(0, context).forEach((item) => rows.push({ kind: "change", change: item }));
      rows.push({ kind: "context", count: block.length - context * 2 });
      block.slice(-context).forEach((item) => rows.push({ kind: "change", change: item }));
    } else {
      block.forEach((item) => rows.push({ kind: "change", change: item }));
    }
  }

  return rows;
}

function pairDiffChanges(changes: DiffChange[]): SplitPairRow[] {
  const rows: SplitPairRow[] = [];
  let index = 0;

  while (index < changes.length) {
    const change = changes[index];
    if (change.type === "normal") {
      rows.push({ kind: "pair", left: change, right: change, normal: true });
      index += 1;
    } else if (change.type === "removed") {
      if (index + 1 < changes.length && changes[index + 1].type === "added") {
        rows.push({ kind: "pair", left: change, right: changes[index + 1] });
        index += 2;
      } else {
        rows.push({ kind: "pair", left: change });
        index += 1;
      }
    } else {
      rows.push({ kind: "pair", right: change });
      index += 1;
    }
  }

  return rows;
}

function compactSplitRows(rows: SplitPairRow[], context = 3, minCollapse = 10): SplitRow[] {
  const compacted: SplitRow[] = [];
  let index = 0;

  while (index < rows.length) {
    const row = rows[index];
    if (!row.normal) {
      compacted.push(row);
      index += 1;
      continue;
    }

    const start = index;
    while (index < rows.length && rows[index].normal) {
      index += 1;
    }

    const block = rows.slice(start, index);
    if (block.length > minCollapse) {
      compacted.push(...block.slice(0, context));
      compacted.push({ kind: "context", count: block.length - context * 2 });
      compacted.push(...block.slice(-context));
    } else {
      compacted.push(...block);
    }
  }

  return compacted;
}

function renderCodeLine(value: string) {
  const parts: Array<{ text: string; type?: string }> = [];
  let lastIndex = 0;

  for (const match of value.matchAll(TOKEN_RE)) {
    const text = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push({ text: value.slice(lastIndex, index) });

    let type = "punctuation";
    if (text.startsWith("//") || text.startsWith("/*")) type = "comment";
    else if (text.startsWith("\"") || text.startsWith("'") || text.startsWith("`")) type = "string";
    else if (/^\d/.test(text)) type = "number";
    else if (KEYWORD_RE.test(text)) type = "keyword";
    KEYWORD_RE.lastIndex = 0;

    parts.push({ text, type });
    lastIndex = index + text.length;
  }

  if (lastIndex < value.length) parts.push({ text: value.slice(lastIndex) });
  if (parts.length === 0) return "\u00a0";

  return parts.map((part, index) => (
    <span key={`${part.text}-${index}`} className={part.type ? `code-token code-token-${part.type}` : undefined}>
      {part.text}
    </span>
  ));
}

export function DiffViewer({ copy, patches, onApply, workspacePath, eventId, onUpdatePatch }: DiffViewerProps) {
  const [selectedFileIdx, setSelectedFileIdx] = useState(0);
  const [isSplit, setIsSplit] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 记录每一个冲突 Block 用户的解决选择: 'ours' | 'theirs' | 'both'
  const [conflictChoices, setConflictChoices] = useState<Record<string, 'ours' | 'theirs' | 'both'>>({});

  // 安全边界防护，如果 patches 为空则平滑渲染
  const currentPatch = patches[selectedFileIdx] || patches[0];

  const diffChanges = useMemo(() => {
    if (!currentPatch || currentPatch.hasConflict) return [];
    return computeLineDiff(currentPatch.oldContent, currentPatch.newContent);
  }, [currentPatch]);
  const inlineRows = useMemo(() => compactInlineRows(diffChanges), [diffChanges]);
  const splitRows = useMemo(() => compactSplitRows(pairDiffChanges(diffChanges)), [diffChanges]);
  const currentStats = useMemo(() => countPatchStats(currentPatch), [currentPatch]);
  const totalStats = useMemo(() => patches.reduce(
    (acc, patch) => {
      const stats = countPatchStats(patch);
      acc.additions += stats.additions;
      acc.deletions += stats.deletions;
      return acc;
    },
    { additions: 0, deletions: 0 },
  ), [patches]);

  const allApplied = patches.every((p) => p.applied);
  const hasUnpreviewedPatch = patches.some((p) => !p.applied && p.sandboxStatus !== "sandboxed");
  const hasFailedPreview = patches.some((p) => !p.applied && (p.sandboxStatus === "failed" || p.applyStatus === "failed"));
  const canRunPatchAction = !allApplied && !currentPatch.hasConflict;
  const patchActionLabel = hasFailedPreview || hasUnpreviewedPatch
    ? (copy.language === "中" ? "重试沙盒预演" : "Retry sandbox preview")
    : copy.diff.applyAll;

  const handleApply = async () => {
    setApplying(true);
    setError(null);
    try {
      await onApply();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setApplying(false);
    }
  };

  const renderApplyAction = (className = "") => (
    <button
      className={`apply-patch-action-btn ${className}`.trim()}
      onClick={handleApply}
      disabled={applying}
    >
      {applying ? (
        <>
          <span className="applying-spinner"></span>
          <span>{copy.diff.writing}</span>
        </>
      ) : (
        <>
          <Check size={14} />
          <span>{patchActionLabel}</span>
        </>
      )}
    </button>
  );

  // 渲染单栏 (Inline) 视图
  const renderInline = () => {
    return (
      <div className="diff-inline-view">
        {inlineRows.map((row, index) => {
          if (row.kind === "context") {
            return (
              <div key={`context-${index}`} className="diff-row diff-context-row">
                <div className="diff-context-spacer" />
                <span>{row.count} {copy.diff.unchangedLines}</span>
              </div>
            );
          }

          const change = row.change;
          let lineClass = "diff-line-normal";
          let prefix = " ";
          if (change.type === "added") {
            lineClass = "diff-line-added";
            prefix = "+";
          } else if (change.type === "removed") {
            lineClass = "diff-line-removed";
            prefix = "-";
          }

          return (
            <div key={index} className={`diff-row diff-inline-row ${lineClass}`}>
              <div className="diff-ln old-ln">
                {change.oldLineNumber !== undefined ? change.oldLineNumber : ""}
              </div>
              <div className="diff-ln new-ln">
                {change.newLineNumber !== undefined ? change.newLineNumber : ""}
              </div>
              <div className="diff-prefix">{prefix}</div>
              <pre className="diff-code-content">{renderCodeLine(change.value)}</pre>
            </div>
          );
        })}
      </div>
    );
  };

  // 渲染双栏 (Split) 视图
  const renderSplit = () => {
    return (
      <div className="diff-split-view">
        <div className="pane-header left-pane">{copy.diff.original}</div>
        <div className="pane-header right-pane">{copy.diff.modified}</div>
        {splitRows.map((row, idx) => {
          if (row.kind === "context") {
            return (
              <div key={`split-context-${idx}`} className="diff-split-context-row">
                <span>{row.count} {copy.diff.unchangedLines}</span>
              </div>
            );
          }

          const leftClass = row.left?.type === "removed" ? "diff-line-removed" : row.left ? "diff-line-normal" : "diff-line-empty";
          const rightClass = row.right?.type === "added" ? "diff-line-added" : row.right ? "diff-line-normal" : "diff-line-empty";

          return (
            <div key={`split-row-${idx}`} className="diff-split-row">
              <div className={`diff-row ${leftClass}`}>
                <div className="diff-ln">{row.left?.oldLineNumber ?? ""}</div>
                <div className="diff-prefix">{row.left?.type === "removed" ? "-" : " "}</div>
                <pre className="diff-code-content">{row.left ? renderCodeLine(row.left.value) : "\u00a0"}</pre>
              </div>
              <div className={`diff-row ${rightClass}`}>
                <div className="diff-ln">{row.right?.newLineNumber ?? ""}</div>
                <div className="diff-prefix">{row.right?.type === "added" ? "+" : " "}</div>
                <pre className="diff-code-content">{row.right ? renderCodeLine(row.right.value) : "\u00a0"}</pre>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderConflictResolver = () => {
    if (!currentPatch || !currentPatch.conflictContent) return null;

    const blocks = parseConflicts(currentPatch.conflictContent);

    const handleChoiceChange = (blockId: string, choice: 'ours' | 'theirs' | 'both') => {
      setConflictChoices((prev) => ({
        ...prev,
        [blockId]: choice,
      }));
    };

    const handleResolve = () => {
      const finalLines: string[] = [];
      blocks.forEach((block) => {
        if (block.type === "normal") {
          finalLines.push(block.content);
        } else {
          const choice = conflictChoices[block.id] || "ours";
          if (choice === "ours") {
            finalLines.push(block.ours);
          } else if (choice === "theirs") {
            finalLines.push(block.theirs);
          } else if (choice === "both") {
            finalLines.push(block.ours);
            finalLines.push(block.theirs);
          }
        }
      });

      const resolvedText = finalLines.join("\n");
      if (onUpdatePatch && eventId) {
        onUpdatePatch(eventId, currentPatch.path, {
          newContent: resolvedText,
          hasConflict: false,
          conflictResolved: true,
          conflictContent: undefined,
          applyStatus: "proposed",
          sandboxStatus: "sandboxed",
        });
      }
    };

    return (
      <div className="conflict-resolver-view">
        <div className="conflict-resolver-alert">
          <AlertCircle size={15} style={{ marginRight: 6 }} />
          <span>{copy.diff.conflictAlert}</span>
        </div>
        <div className="conflict-blocks-list">
          {blocks.map((block, idx) => {
            if (block.type === "normal") {
              return (
                <div key={idx} className="conflict-normal-block">
                  <pre className="conflict-code-pre">{block.content}</pre>
                </div>
              );
            }

            const choice = conflictChoices[block.id] || "ours";

            return (
              <div key={block.id} className="conflict-editor-block">
                <div className="conflict-editor-header">
                  <span className="conflict-badge">{copy.diff.conflictBlock} #{block.id.split("-")[1]}</span>
                  <div className="conflict-choice-actions">
                    <button
                      className={`conflict-choice-btn ours ${choice === "ours" ? "active" : ""}`}
                      onClick={() => handleChoiceChange(block.id, "ours")}
                    >
                      {copy.diff.keepAi}
                    </button>
                    <button
                      className={`conflict-choice-btn theirs ${choice === "theirs" ? "active" : ""}`}
                      onClick={() => handleChoiceChange(block.id, "theirs")}
                    >
                      {copy.diff.keepLocal}
                    </button>
                    <button
                      className={`conflict-choice-btn both ${choice === "both" ? "active" : ""}`}
                      onClick={() => handleChoiceChange(block.id, "both")}
                    >
                      {copy.diff.keepBoth}
                    </button>
                  </div>
                </div>

                <div className="conflict-split-pane">
                  <div className={`conflict-pane-side ours-side ${choice === "ours" || choice === "both" ? "selected" : "dimmed"}`}>
                    <div className="side-title">{copy.diff.oursTitle}</div>
                    <pre className="side-content">{block.ours || <span className="empty-line-hint">{copy.diff.emptyLine}</span>}</pre>
                  </div>
                  <div className={`conflict-pane-side theirs-side ${choice === "theirs" || choice === "both" ? "selected" : "dimmed"}`}>
                    <div className="side-title">{copy.diff.theirsTitle}</div>
                    <pre className="side-content">{block.theirs || <span className="empty-line-hint">{copy.diff.emptyLine}</span>}</pre>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="conflict-resolver-action-bar">
          <button className="resolve-conflict-submit-btn" onClick={handleResolve}>
            <Check size={13} style={{ marginRight: 6 }} />
            <span>{copy.diff.resolve}</span>
          </button>
        </div>
      </div>
    );
  };

  if (patches.length === 0 || !currentPatch) {
    return null;
  }

  return (
    <section className="diff-viewer-card">
      <div className="diff-tabs-bar">
        <div className="diff-summary-pill">
          <span>{patches.length} {copy.diff.changedFiles}</span>
          <strong className="diff-additions">+{totalStats.additions}</strong>
          <strong className="diff-deletions">-{totalStats.deletions}</strong>
        </div>
        {patches.map((p, idx) => {
          const fileName = p.path.split("/").pop() || p.path;
          const target = createFileActionTarget({ workspacePath, path: p.path, sourceSurface: "diff" });
          return (
            <FileActionMenu key={p.path} copy={copy} target={target} openOnClick={false} className="file-action-diff-trigger">
              <button
                className={`diff-tab-item ${selectedFileIdx === idx ? "active" : ""}`}
                onClick={() => setSelectedFileIdx(idx)}
              >
                <FileCode size={13} style={{ marginRight: 6 }} />
                <span>{fileName}</span>
                {p.applied && <Check size={12} className="diff-tab-check" />}
              </button>
            </FileActionMenu>
          );
        })}
      </div>

      <header className="diff-header">
        <div className="diff-file-info">
          <FileCode size={16} className="text-muted-foreground" />
          <FileActionMenu
            copy={copy}
            target={createFileActionTarget({ workspacePath, path: currentPatch.path, sourceSurface: "diff" })}
          >
            <span className="diff-filename file-action-path-label">{currentPatch.path}</span>
          </FileActionMenu>
          <span className="diff-file-stats">
            <strong className="diff-additions">+{currentStats.additions}</strong>
            <strong className="diff-deletions">-{currentStats.deletions}</strong>
          </span>
        </div>
        <div className="diff-header-actions">
          {canRunPatchAction && renderApplyAction("apply-patch-action-btn-header")}
          {!currentPatch.hasConflict && (
            <button
              className={`diff-layout-toggle-btn ${isSplit ? "active" : ""}`}
              onClick={() => setIsSplit(!isSplit)}
              title={copy.diff.splitTitle}
            >
              <Columns size={14} />
              <span>{isSplit ? copy.diff.inline : copy.diff.split}</span>
            </button>
          )}
        </div>
      </header>

      <div className="diff-viewport">
        {currentPatch.hasConflict ? renderConflictResolver() : (isSplit ? renderSplit() : renderInline())}
      </div>

      {error && (
        <div className="diff-error-banner">
          <AlertCircle size={14} />
          <span>{copy.diff.applyError}: {error}</span>
        </div>
      )}

      <footer className="diff-actions-footer">
        {allApplied ? (
          <div className="applied-badge-container">
            <Check size={14} className="success-icon" />
            <span>{copy.diff.allApplied}</span>
          </div>
        ) : currentPatch.hasConflict ? (
          <div className="applied-badge-container warning">
            <AlertCircle size={14} className="warning-icon" style={{ color: "#f87171", marginRight: 6 }} />
            <span className="diff-conflict-warning-text">{copy.diff.resolveBeforeApply}</span>
          </div>
        ) : hasFailedPreview ? (
          <div className="applied-badge-container warning">
            <AlertCircle size={14} className="warning-icon" style={{ color: "#f87171", marginRight: 6 }} />
            <span className="diff-conflict-warning-text">{copy.diff.previewFailed}</span>
          </div>
        ) : hasUnpreviewedPatch ? (
          <div className="applied-badge-container warning">
            <AlertCircle size={14} className="warning-icon" style={{ color: "#f59e0b", marginRight: 6 }} />
            <span className="diff-conflict-warning-text">{copy.diff.previewBeforeApply}</span>
          </div>
        ) : (
          <div className="applied-badge-container muted">
            <span>{copy.diff.readyToApply}</span>
          </div>
        )}
      </footer>
    </section>
  );
}
