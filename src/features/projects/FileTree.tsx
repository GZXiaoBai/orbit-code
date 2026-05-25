import { ChevronDown, ChevronRight, FileCode2, Folder, FolderOpen } from "lucide-react";
import type { CSSProperties } from "react";
import type { FileTreeNode } from "../../domain/fileTree";

interface FileTreeProps {
  nodes: FileTreeNode[];
  expandedDirs: Set<string>;
  activeFilePath?: string;
  filter: string;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
}

function HighlightedName({ name, filter }: { name: string; filter: string }) {
  const query = filter.trim();
  if (!query) return <>{name}</>;

  const index = name.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return <>{name}</>;

  return (
    <>
      {name.slice(0, index)}
      <mark>{name.slice(index, index + query.length)}</mark>
      {name.slice(index + query.length)}
    </>
  );
}

interface FileTreeRowProps extends Omit<FileTreeProps, "nodes"> {
  node: FileTreeNode;
}

function FileTreeRow({
  node,
  expandedDirs,
  activeFilePath,
  filter,
  onToggleDir,
  onSelectFile,
}: FileTreeRowProps) {
  const isDirectory = node.type === "directory";
  const isExpanded = expandedDirs.has(node.path) || Boolean(filter.trim());
  const isActive = activeFilePath === node.path;

  if (isDirectory) {
    return (
      <div className="file-tree-node-wrap">
        <button
          type="button"
          className={`file-tree-node directory ${isExpanded ? "expanded" : ""}`}
          style={{ "--tree-depth": node.depth } as CSSProperties}
          onClick={() => onToggleDir(node.path)}
          aria-expanded={isExpanded}
        >
          <span className="file-tree-disclosure">{isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
          <span className="file-tree-icon">{isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />}</span>
          <span className="file-tree-name"><HighlightedName name={node.name} filter={filter} /></span>
        </button>
        {isExpanded && node.children?.length ? (
          <div className="file-tree-children">
            {node.children.map((child) => (
              <FileTreeRow
                key={child.path}
                node={child}
                expandedDirs={expandedDirs}
                activeFilePath={activeFilePath}
                filter={filter}
                onToggleDir={onToggleDir}
                onSelectFile={onSelectFile}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`file-tree-node file ${isActive ? "active" : ""}`}
      style={{ "--tree-depth": node.depth } as CSSProperties}
      onClick={() => onSelectFile(node.path)}
      title={node.path}
    >
      <span className="file-tree-disclosure file-tree-disclosure-placeholder" />
      <span className="file-tree-icon"><FileCode2 size={14} /></span>
      <span className="file-tree-name"><HighlightedName name={node.name} filter={filter} /></span>
    </button>
  );
}

export function FileTree(props: FileTreeProps) {
  return (
    <div className="file-tree-list" role="tree">
      {props.nodes.map((node) => (
        <FileTreeRow key={node.path} {...props} node={node} />
      ))}
    </div>
  );
}
