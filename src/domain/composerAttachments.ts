import type { ComposerAttachment } from "./types";

const SHORT_TEXT_LIMIT = 1800;
const LONG_TEXT_ATTACHMENT_LIMIT = 120_000;

export interface PasteClassification {
  action: "insert" | "attach";
  attachment?: ComposerAttachment;
}

function createId() {
  return `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function looksLikePlan(text: string) {
  const trimmed = text.trim();
  return (
    /^version:\s*["']?\d+/im.test(trimmed) && /^tasks:\s*$/im.test(trimmed)
  ) || (
    /^#\s+.+/m.test(trimmed) && /(^|\n)\s*[-*]\s+\[[ xX]\]/.test(trimmed)
  ) || /(^|\n)\s*(goals|constraints|acceptanceCriteria|risks):\s*$/i.test(trimmed);
}

function looksLikeCode(text: string) {
  const trimmed = text.trim();
  const lines = trimmed.split("\n");
  if (/```/.test(trimmed)) return true;
  if (/^(diff --git|@@\s|---\s|\+\+\+\s)/m.test(trimmed)) return true;
  if (/^\s*[{[][\s\S]*[}\]]\s*$/.test(trimmed) && lines.length >= 2) return true;
  if (/^<([a-z][\w-]*)(\s|>)[\s\S]*<\/\1>$/i.test(trimmed)) return true;
  if (/(^|\n)\s*(import|export|fn|class|interface|type|const|let|var|def|func)\s+/m.test(trimmed)) return true;
  if (/^\s*(const|let|var|return|await|if|for|while)\b.+[;{}]\s*$/m.test(trimmed)) return true;
  const indentedCodeLines = lines.filter((line) => /^( {2,}|\t)\S/.test(line)).length;
  if (lines.length >= 3 && indentedCodeLines >= 2) return true;
  return /[{};]/.test(trimmed) && lines.length >= 4;
}

export function classifyPastedText(text: string): PasteClassification {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.trim()) return { action: "insert" };
  if (!looksLikePlan(normalized) && !looksLikeCode(normalized) && normalized.length <= SHORT_TEXT_LIMIT) {
    return { action: "insert" };
  }

  const kind: ComposerAttachment["kind"] = looksLikePlan(normalized)
    ? "plan"
    : looksLikeCode(normalized)
      ? "code"
      : "text";
  const content = normalized.slice(0, LONG_TEXT_ATTACHMENT_LIMIT);
  return {
    action: "attach",
    attachment: {
      id: createId(),
      name: kind === "plan" ? "pasted-plan.md" : kind === "code" ? "pasted-code.txt" : "pasted-text.txt",
      mime: "text/plain",
      size: normalized.length,
      kind,
      content,
      source: "paste",
    },
  };
}

export function classifyFileKind(file: File): ComposerAttachment["kind"] {
  const name = file.name.toLowerCase();
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".yaml") || name.endsWith(".yml") || name.endsWith(".md") || name.endsWith(".markdown")) return "plan";
  if (/\.(ts|tsx|js|jsx|rs|py|go|java|kt|swift|css|scss|html|json|toml|sql|sh|zsh|mdx)$/.test(name)) return "code";
  if (file.type.startsWith("text/")) return "text";
  return "unknown";
}

export async function attachmentFromFile(file: File, source: ComposerAttachment["source"]): Promise<ComposerAttachment> {
  const kind = classifyFileKind(file);
  const shouldReadText = ["text", "code", "plan"].includes(kind) && file.size <= LONG_TEXT_ATTACHMENT_LIMIT;
  return {
    id: createId(),
    name: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
    kind,
    content: shouldReadText ? await file.text() : undefined,
    source,
  };
}

export function formatAttachmentContext(attachments: ComposerAttachment[]) {
  if (attachments.length === 0) return "";
  return [
    "",
    "附加上下文（来自 Composer 附件，只读，不代表直接写入文件）：",
    ...attachments.map((attachment) => {
      const header = `- ${attachment.name} (${attachment.kind}, ${attachment.size} bytes)`;
      if (!attachment.content) return header;
      return `${header}\n\`\`\`\n${attachment.content.slice(0, 8000)}\n\`\`\``;
    }),
  ].join("\n");
}
