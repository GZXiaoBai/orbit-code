import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownText } from "../components/thread/MarkdownText";

describe("MarkdownText", () => {
  it("renders common assistant markdown without exposing raw markers", () => {
    const html = renderToStaticMarkup(
      <MarkdownText
        text={[
          "# Plan",
          "Use **bold**, __strong__, *emphasis*, ~~removed~~, `inline code`, and [Orbit](https://example.com).",
          "",
          "- first",
          "- second",
          "",
          "1. inspect",
          "2. patch",
          "",
          "> quoted context",
          "",
          "- [x] done",
          "- [ ] pending",
          "",
          "---",
          "",
          "```ts",
          "const ok = true;",
          "```",
        ].join("\n")}
      />,
    );

    expect(html).toContain("<h3>Plan</h3>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<strong>strong</strong>");
    expect(html).toContain("<em>emphasis</em>");
    expect(html).toContain("<del>removed</del>");
    expect(html).toContain("<code>inline code</code>");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("<ul>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<blockquote>quoted context</blockquote>");
    expect(html).toContain("markdown-task-list");
    expect(html).toContain("checked=\"\"");
    expect(html).toContain("<hr/>");
    expect(html).toContain("class=\"language-ts\"");
    expect(html).toContain("const ok = true;");
    expect(html).not.toContain("**bold**");
  });

  it("rejects unsafe links while preserving the label text", () => {
    const html = renderToStaticMarkup(
      <MarkdownText text="[safe](https://example.com) [bad](javascript:alert(1))" />,
    );

    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("bad");
    expect(html).not.toContain("javascript:");
  });
});
