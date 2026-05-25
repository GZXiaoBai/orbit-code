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
