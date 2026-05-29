import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RichFileText } from "../components/thread/RichFileText";
import { copy } from "../i18n/copy";

describe("rich file text renderer", () => {
  it("renders file links and inline code paths as safe React markup", () => {
    const html = renderToStaticMarkup(
      <RichFileText
        copy={copy.zh}
        workspacePath="/Users/me/Project"
        surface="timeline"
        text={'Open [App](file:///Users/me/Project/src/App.tsx:10) and `src/main.ts` <script>alert(1)</script>'}
      />,
    );

    expect(html).toContain("data-file-action-target=\"src/App.tsx\"");
    expect(html).toContain("data-file-action-target=\"src/main.ts\"");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
