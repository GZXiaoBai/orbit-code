import { useState, useMemo } from "react";
import { Check, Columns, FileCode, Play, AlertCircle } from "lucide-react";
import type { AppCopy } from "../i18n/copy";
import { computeLineDiff } from "../utils/diff";

interface DiffPatch {
  path: string;
  oldContent: string;
  newContent: string;
  applied: boolean;
  hasConflict?: boolean;
  conflictContent?: string;
  conflictResolved?: boolean;
}

interface DiffViewerProps {
  copy: AppCopy;
  patches: DiffPatch[];
  onApply: () => Promise<void>;
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

export function DiffViewer({ copy, patches, onApply, eventId, onUpdatePatch }: DiffViewerProps) {
  const [selectedFileIdx, setSelectedFileIdx] = useState(0);
  const [isSplit, setIsSplit] = useState(false);
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

  const allApplied = patches.every((p) => p.applied);

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

  // 渲染单栏 (Inline) 视图
  const renderInline = () => {
    return (
      <div className="diff-inline-view">
        {diffChanges.map((change, index) => {
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
            <div key={index} className={`diff-row ${lineClass}`}>
              <div className="diff-ln old-ln">
                {change.oldLineNumber !== undefined ? change.oldLineNumber : ""}
              </div>
              <div className="diff-ln new-ln">
                {change.newLineNumber !== undefined ? change.newLineNumber : ""}
              </div>
              <div className="diff-prefix">{prefix}</div>
              <pre className="diff-code-content">{change.value}</pre>
            </div>
          );
        })}
      </div>
    );
  };

  // 渲染双栏 (Split) 视图
  const renderSplit = () => {
    const leftRows: any[] = [];
    const rightRows: any[] = [];

    let i = 0;
    while (i < diffChanges.length) {
      const change = diffChanges[i];
      if (change.type === "normal") {
        leftRows.push(change);
        rightRows.push(change);
        i++;
      } else if (change.type === "removed") {
        leftRows.push(change);
        if (i + 1 < diffChanges.length && diffChanges[i + 1].type === "added") {
          rightRows.push(diffChanges[i + 1]);
          i += 2;
        } else {
          rightRows.push({ type: "empty" });
          i++;
        }
      } else if (change.type === "added") {
        leftRows.push({ type: "empty" });
        rightRows.push(change);
        i++;
      }
    }

    return (
      <div className="diff-split-view">
        <div className="diff-split-pane left-pane">
          <div className="pane-header">Original</div>
          <div className="pane-body">
            {leftRows.map((row, idx) => {
              if (row.type === "empty") {
                return (
                  <div key={idx} className="diff-row diff-line-empty">
                    <div className="diff-ln">&nbsp;</div>
                    <div className="diff-prefix">&nbsp;</div>
                    <pre className="diff-code-content">&nbsp;</pre>
                  </div>
                );
              }
              const isRem = row.type === "removed";
              return (
                <div key={idx} className={`diff-row ${isRem ? "diff-line-removed" : "diff-line-normal"}`}>
                  <div className="diff-ln">{row.oldLineNumber}</div>
                  <div className="diff-prefix">{isRem ? "-" : " "}</div>
                  <pre className="diff-code-content">{row.value}</pre>
                </div>
              );
            })}
          </div>
        </div>
        <div className="diff-split-pane right-pane">
          <div className="pane-header">Modified</div>
          <div className="pane-body">
            {rightRows.map((row, idx) => {
              if (row.type === "empty") {
                return (
                  <div key={idx} className="diff-row diff-line-empty">
                    <div className="diff-ln">&nbsp;</div>
                    <div className="diff-prefix">&nbsp;</div>
                    <pre className="diff-code-content">&nbsp;</pre>
                  </div>
                );
              }
              const isAdd = row.type === "added";
              return (
                <div key={idx} className={`diff-row ${isAdd ? "diff-line-added" : "diff-line-normal"}`}>
                  <div className="diff-ln">{row.newLineNumber}</div>
                  <div className="diff-prefix">{isAdd ? "+" : " "}</div>
                  <pre className="diff-code-content">{row.value}</pre>
                </div>
              );
            })}
          </div>
        </div>
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
        {patches.map((p, idx) => {
          const fileName = p.path.split("/").pop() || p.path;
          return (
            <button
              key={p.path}
              className={`diff-tab-item ${selectedFileIdx === idx ? "active" : ""}`}
              onClick={() => setSelectedFileIdx(idx)}
            >
              <FileCode size={13} style={{ marginRight: 6 }} />
              <span>{fileName}</span>
              {p.applied && <Check size={12} className="diff-tab-check" />}
            </button>
          );
        })}
      </div>

      <header className="diff-header">
        <div className="diff-file-info">
          <FileCode size={16} className="text-muted-foreground" />
          <span className="diff-filename">{currentPatch.path}</span>
        </div>
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
        ) : (
          <button
            className="apply-patch-action-btn"
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
                <Play size={13} style={{ fill: "currentColor" }} />
                <span>{copy.diff.applyAll}</span>
              </>
            )}
          </button>
        )}
      </footer>
    </section>
  );
}
