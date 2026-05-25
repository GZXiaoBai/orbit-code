export type FileTreeNodeType = "file" | "directory";

export interface FileTreeNode {
  name: string;
  path: string;
  type: FileTreeNodeType;
  depth: number;
  children?: FileTreeNode[];
}

interface MutableTreeNode extends FileTreeNode {
  children?: MutableTreeNode[];
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function sortNodes(nodes: MutableTreeNode[]): FileTreeNode[] {
  return nodes
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
    })
    .map((node) => ({
      ...node,
      children: node.children ? sortNodes(node.children) : undefined,
    }));
}

export function buildFileTree(paths: string[]): FileTreeNode[] {
  const root: MutableTreeNode[] = [];
  const dirMap = new Map<string, MutableTreeNode>();

  for (const rawPath of paths) {
    const path = normalizePath(rawPath);
    if (!path) continue;

    const parts = path.split("/").filter(Boolean);
    let siblings = root;
    let currentPath = "";

    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = index === parts.length - 1;

      if (isFile) {
        if (!siblings.some((node) => node.path === currentPath && node.type === "file")) {
          siblings.push({ name: part, path: currentPath, type: "file", depth: index });
        }
        return;
      }

      let directory = dirMap.get(currentPath);
      if (!directory) {
        directory = { name: part, path: currentPath, type: "directory", depth: index, children: [] };
        dirMap.set(currentPath, directory);
        siblings.push(directory);
      }
      siblings = directory.children || [];
    });
  }

  return sortNodes(root);
}

export function filterFileTree(nodes: FileTreeNode[], query: string): FileTreeNode[] {
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) return nodes;

  const filterNode = (node: FileTreeNode): FileTreeNode | null => {
    const selfMatches = node.path.toLowerCase().includes(cleanQuery) || node.name.toLowerCase().includes(cleanQuery);
    const children = node.children?.map(filterNode).filter((child): child is FileTreeNode => Boolean(child)) || [];
    if (!selfMatches && children.length === 0) return null;
    return {
      ...node,
      children: node.type === "directory" ? children : undefined,
    };
  };

  return nodes.map(filterNode).filter((node): node is FileTreeNode => Boolean(node));
}

export function parentDirsForPath(path: string): string[] {
  const parts = normalizePath(path).split("/").filter(Boolean);
  const dirs: string[] = [];
  for (let index = 0; index < parts.length - 1; index++) {
    dirs.push(parts.slice(0, index + 1).join("/"));
  }
  return dirs;
}

export function defaultExpandedDirs(paths: string[], activePath?: string | null): Set<string> {
  void paths;
  const expanded = new Set<string>();

  if (activePath) {
    for (const dir of parentDirsForPath(activePath)) expanded.add(dir);
  }

  return expanded;
}

export function addRecentFile(recentFiles: string[], path: string, limit = 8): string[] {
  const normalized = normalizePath(path);
  if (!normalized) return recentFiles;
  return [normalized, ...recentFiles.filter((item) => item !== normalized)].slice(0, limit);
}
