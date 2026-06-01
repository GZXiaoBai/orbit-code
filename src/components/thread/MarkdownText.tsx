import type { ReactNode } from "react";

interface MarkdownTextProps {
  text: string;
  live?: boolean;
}

function safeHref(href: string) {
  const trimmed = href.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("#") || trimmed.startsWith("/")) return trimmed;
  return undefined;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let remaining = text;
  let index = 0;

  while (remaining) {
    const candidates = [
      { token: "`", at: remaining.indexOf("`") },
      { token: "**", at: remaining.indexOf("**") },
      { token: "__", at: remaining.indexOf("__") },
      { token: "~~", at: remaining.indexOf("~~") },
      { token: "*", at: remaining.indexOf("*") },
      { token: "[", at: remaining.indexOf("[") },
    ]
      .filter((candidate) => candidate.at >= 0)
      .sort((a, b) => a.at - b.at || b.token.length - a.token.length);

    const next = candidates[0];
    if (!next) {
      nodes.push(remaining);
      break;
    }
    if (next.at > 0) {
      nodes.push(remaining.slice(0, next.at));
      remaining = remaining.slice(next.at);
      continue;
    }

    if (next.token === "`") {
      const end = remaining.indexOf("`", 1);
      if (end > 0) {
        nodes.push(<code key={`${keyPrefix}-code-${index++}`}>{remaining.slice(1, end)}</code>);
        remaining = remaining.slice(end + 1);
        continue;
      }
    }

    if (next.token === "**" || next.token === "__") {
      const end = remaining.indexOf(next.token, 2);
      if (end > 2) {
        nodes.push(<strong key={`${keyPrefix}-strong-${index++}`}>{renderInline(remaining.slice(2, end), `${keyPrefix}-strong-${index}`)}</strong>);
        remaining = remaining.slice(end + 2);
        continue;
      }
    }

    if (next.token === "~~") {
      const end = remaining.indexOf("~~", 2);
      if (end > 2) {
        nodes.push(<del key={`${keyPrefix}-del-${index++}`}>{renderInline(remaining.slice(2, end), `${keyPrefix}-del-${index}`)}</del>);
        remaining = remaining.slice(end + 2);
        continue;
      }
    }

    if (next.token === "*") {
      const end = remaining.indexOf("*", 1);
      if (end > 1) {
        nodes.push(<em key={`${keyPrefix}-em-${index++}`}>{renderInline(remaining.slice(1, end), `${keyPrefix}-em-${index}`)}</em>);
        remaining = remaining.slice(end + 1);
        continue;
      }
    }

    if (next.token === "[") {
      const textEnd = remaining.indexOf("]");
      const hrefStart = textEnd >= 0 ? remaining.indexOf("(", textEnd) : -1;
      const hrefEnd = hrefStart >= 0 ? remaining.indexOf(")", hrefStart) : -1;
      if (textEnd > 1 && hrefStart === textEnd + 1 && hrefEnd > hrefStart + 1) {
        const label = remaining.slice(1, textEnd);
        const href = safeHref(remaining.slice(hrefStart + 1, hrefEnd));
        nodes.push(href ? (
          <a key={`${keyPrefix}-link-${index++}`} href={href} target="_blank" rel="noreferrer">
            {renderInline(label, `${keyPrefix}-link-${index}`)}
          </a>
        ) : label);
        remaining = remaining.slice(hrefEnd + 1);
        continue;
      }
    }

    nodes.push(remaining[0]);
    remaining = remaining.slice(1);
  }

  return nodes;
}

function renderBlocks(text: string) {
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let index = 0;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const body = paragraph.join(" ");
    blocks.push(<p key={`p-${index}`}>{renderInline(body, `p-${index++}`)}</p>);
    paragraph = [];
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      lineIndex += 1;
      while (lineIndex < lines.length && !lines[lineIndex].trim().startsWith("```")) {
        codeLines.push(lines[lineIndex]);
        lineIndex += 1;
      }
      blocks.push(
        <pre key={`code-${index}`} className={language ? `language-${language}` : undefined}>
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      index += 1;
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const children = renderInline(heading[2], `h-${index}`);
      blocks.push(level === 1
        ? <h3 key={`h-${index}`}>{children}</h3>
        : level === 2
          ? <h4 key={`h-${index}`}>{children}</h4>
          : <h5 key={`h-${index}`}>{children}</h5>);
      index += 1;
      continue;
    }

    if (/^(---|\*\*\*)$/.test(trimmed)) {
      flushParagraph();
      blocks.push(<hr key={`hr-${index}`} />);
      index += 1;
      continue;
    }

    const blockquote = /^>\s?(.+)$/.exec(trimmed);
    if (blockquote) {
      flushParagraph();
      const items: string[] = [blockquote[1]];
      while (lineIndex + 1 < lines.length) {
        const next = /^>\s?(.+)$/.exec(lines[lineIndex + 1].trim());
        if (!next) break;
        items.push(next[1]);
        lineIndex += 1;
      }
      blocks.push(<blockquote key={`quote-${index}`}>{renderInline(items.join(" "), `quote-${index}`)}</blockquote>);
      index += 1;
      continue;
    }

    const task = /^[-*]\s+\[([ xX])\]\s+(.+)$/.exec(trimmed);
    if (task) {
      flushParagraph();
      const items: Array<{ checked: boolean; text: string }> = [{ checked: task[1].toLowerCase() === "x", text: task[2] }];
      while (lineIndex + 1 < lines.length) {
        const next = /^[-*]\s+\[([ xX])\]\s+(.+)$/.exec(lines[lineIndex + 1].trim());
        if (!next) break;
        items.push({ checked: next[1].toLowerCase() === "x", text: next[2] });
        lineIndex += 1;
      }
      blocks.push(
        <ul key={`task-${index}`} className="markdown-task-list">
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>
              <input type="checkbox" checked={item.checked} readOnly aria-label={item.checked ? "completed" : "pending"} />
              <span>{renderInline(item.text, `task-${index}-${itemIndex}`)}</span>
            </li>
          ))}
        </ul>,
      );
      index += 1;
      continue;
    }

    const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      const items: string[] = [bullet[1]];
      while (lineIndex + 1 < lines.length) {
        const next = /^[-*]\s+(.+)$/.exec(lines[lineIndex + 1].trim());
        if (!next) break;
        items.push(next[1]);
        lineIndex += 1;
      }
      blocks.push(<ul key={`ul-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, `ul-${index}-${itemIndex}`)}</li>)}</ul>);
      index += 1;
      continue;
    }

    const ordered = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (ordered) {
      flushParagraph();
      const items: string[] = [ordered[1]];
      while (lineIndex + 1 < lines.length) {
        const next = /^\d+\.\s+(.+)$/.exec(lines[lineIndex + 1].trim());
        if (!next) break;
        items.push(next[1]);
        lineIndex += 1;
      }
      blocks.push(<ol key={`ol-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, `ol-${index}-${itemIndex}`)}</li>)}</ol>);
      index += 1;
      continue;
    }

    paragraph.push(trimmed);
  }
  flushParagraph();
  return blocks;
}

export function MarkdownText({ text, live = false }: MarkdownTextProps) {
  return (
    <div className={`node-message markdown-message ${live ? "codex-live-text" : ""}`}>
      {text ? renderBlocks(text) : null}
      {live ? <span className="codex-live-caret" aria-hidden="true" /> : null}
    </div>
  );
}
