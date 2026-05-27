import { describe, expect, it } from "vitest";
import { classifyPastedText } from "../domain/composerAttachments";

describe("composer attachment classifier", () => {
  it("inserts short plain text directly", () => {
    expect(classifyPastedText("please fix the sidebar").action).toBe("insert");
  });

  it("turns code blocks into attachment context", () => {
    const result = classifyPastedText("```ts\nexport const value = 1;\n```");

    expect(result.action).toBe("attach");
    expect(result.attachment?.kind).toBe("code");
  });

  it("turns single-line code into attachment context instead of corrupting the composer", () => {
    const result = classifyPastedText("const total = items.reduce((sum, item) => sum + item.price, 0);");

    expect(result.action).toBe("attach");
    expect(result.attachment?.kind).toBe("code");
  });

  it("turns JSON snippets into code attachment context", () => {
    const result = classifyPastedText('{\n  "scripts": {\n    "test": "vitest run"\n  }\n}');

    expect(result.action).toBe("attach");
    expect(result.attachment?.kind).toBe("code");
  });

  it("turns YAML plans into explicit plan attachments", () => {
    const result = classifyPastedText("version: 1\ntasks:\n  - id: t1\n    title: Fix");

    expect(result.action).toBe("attach");
    expect(result.attachment?.kind).toBe("plan");
  });

  it("turns long text into attachment context", () => {
    const result = classifyPastedText("a".repeat(2400));

    expect(result.action).toBe("attach");
    expect(result.attachment?.kind).toBe("text");
  });
});
