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

  it("renders assistant markdown tables as tables instead of collapsed pipe text", () => {
    const html = renderToStaticMarkup(
      <MarkdownText
        text={[
          "| 问题 | 描述 | 建议 |",
          "| --- | --- | --- |",
          "| 全局 ID 冲突 | `nextId` 是模块级变量 | 放进 `createTaskBoard` 闭包 |",
          "| 缺少 `.gitignore` | `dist/` 可能被提交 | 添加忽略规则 |",
        ].join("\n")}
      />,
    );

    expect(html).toContain("<table>");
    expect(html).toContain("<th>问题</th>");
    expect(html).toContain("<td>全局 ID 冲突</td>");
    expect(html).toContain("<code>nextId</code>");
    expect(html).not.toContain("| --- | --- | --- |");
  });

  it("renders all markdown heading levels used by agent reports", () => {
    const html = renderToStaticMarkup(
      <MarkdownText
        text={[
          "#### 3.2 路由与多页面",
          "##### 4.1 更新 README.md",
          "###### 细节",
        ].join("\n")}
      />,
    );

    expect(html).toContain("<h6>3.2 路由与多页面</h6>");
    expect(html).toContain("<h6>4.1 更新 README.md</h6>");
    expect(html).toContain("<h6>细节</h6>");
    expect(html).not.toContain("#### 3.2");
    expect(html).not.toContain("##### 4.1");
    expect(html).not.toContain("###### 细节");
  });

  it("repairs agent table rows that arrive concatenated without newlines", () => {
    const html = renderToStaticMarkup(
      <MarkdownText text="| 问题 | 描述 | 建议 ||------|------|------|| 全局 ID 冲突 | `nextId` 是模块变量 | 放进闭包 |" />,
    );

    expect(html).toContain("<table>");
    expect(html).toContain("<th>问题</th>");
    expect(html).toContain("<td>全局 ID 冲突</td>");
    expect(html).toContain("<code>nextId</code>");
    expect(html).not.toContain("||------");
  });
});
