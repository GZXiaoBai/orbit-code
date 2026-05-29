import type { ReactNode } from "react";
import { createFileActionTarget, looksLikeFilePath } from "../../domain/fileActions";
import type { FileActionSurface } from "../../domain/fileActions";
import type { AppCopy } from "../../i18n/copy";
import { FileActionMenu } from "../../features/files/FileActionMenu";

interface RichFileTextProps {
  copy: AppCopy;
  text: string;
  workspacePath?: string;
  surface: FileActionSurface;
}

export function RichFileText({ copy, text, workspacePath, surface }: RichFileTextProps) {
  return <>{renderRichText(copy, text, workspacePath, surface)}</>;
}

function renderRichText(copy: AppCopy, text: string, workspacePath: string | undefined, surface: FileActionSurface): ReactNode[] {
  const nodes: ReactNode[] = [];
  const linkPattern = /\[([^\]]+)\]\((file:\/\/[^)]+)\)/g;
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(text)) !== null) {
    if (match.index > index) {
      nodes.push(...renderInlineText(copy, text.slice(index, match.index), workspacePath, surface, `text-${index}`));
    }
    const target = createFileActionTarget({ workspacePath, path: match[2], sourceSurface: surface });
    nodes.push(
      <FileActionMenu key={`file-link-${match.index}`} copy={copy} target={target}>
        <button type="button" className="file-link file-action-link">{match[1]}</button>
      </FileActionMenu>,
    );
    index = match.index + match[0].length;
  }

  if (index < text.length) {
    nodes.push(...renderInlineText(copy, text.slice(index), workspacePath, surface, `text-${index}`));
  }
  return nodes;
}

function renderInlineText(
  copy: AppCopy,
  text: string,
  workspacePath: string | undefined,
  surface: FileActionSurface,
  keyPrefix: string,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const codePattern = /`([^`]+)`/g;
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = codePattern.exec(text)) !== null) {
    if (match.index > index) nodes.push(...renderPlainText(text.slice(index, match.index), `${keyPrefix}-plain-${index}`));
    const value = match[1];
    const target = looksLikeFilePath(value)
      ? createFileActionTarget({ workspacePath, path: value, sourceSurface: surface })
      : null;
    nodes.push(
      <FileActionMenu key={`${keyPrefix}-code-${match.index}`} copy={copy} target={target}>
        <code className={target ? "file-action-code" : undefined}>{value}</code>
      </FileActionMenu>,
    );
    index = match.index + match[0].length;
  }

  if (index < text.length) nodes.push(...renderPlainText(text.slice(index), `${keyPrefix}-plain-${index}`));
  return nodes;
}

function renderPlainText(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split("\n");
  return parts.flatMap((part, index) => {
    const nodes: ReactNode[] = [];
    if (part) nodes.push(<span key={`${keyPrefix}-${index}`}>{part}</span>);
    if (index < parts.length - 1) nodes.push(<br key={`${keyPrefix}-br-${index}`} />);
    return nodes;
  });
}
