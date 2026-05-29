import { describe, expect, it } from "vitest";
import { parseToolEnvelopes } from "../domain/agentToolEnvelope";

describe("agent tool envelope", () => {
  it("accepts strict JSON tool lines", () => {
    const parsed = parseToolEnvelopes('{"tool":"run_command","params":{"command":"npm","args":["test","--","--run"],"reason":"verify"}}');
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.envelopes[0]).toMatchObject({
      tool: "run_command",
      params: { command: "npm", args: ["test", "--", "--run"], reason: "verify" },
    });
  });

  it("accepts fenced pretty JSON from real providers", () => {
    const parsed = parseToolEnvelopes([
      "下一步读取项目文件。",
      "```json",
      "{",
      '  "tool": "list_files",',
      '  "params": { "filter": "orbit-mini-lab" }',
      "}",
      "```",
    ].join("\n"));

    expect(parsed.errors).toHaveLength(0);
    expect(parsed.envelopes[0]).toEqual({
      tool: "list_files",
      params: { filter: "orbit-mini-lab" },
    });
  });

  it("rejects malformed or unknown tool calls", () => {
    const parsed = parseToolEnvelopes('{"tool":"delete_everything","params":{"path":"."}}');
    expect(parsed.envelopes).toHaveLength(0);
    expect(parsed.errors.length).toBeGreaterThan(0);
  });

  it("rejects missing required params", () => {
    const parsed = parseToolEnvelopes('{"tool":"apply_patch","params":{"patches":[]}}');
    expect(parsed.envelopes).toHaveLength(0);
    expect(parsed.errors.length).toBeGreaterThan(0);
  });

  it("preserves structured command args with spaces", () => {
    const parsed = parseToolEnvelopes('{"tool":"run_command","params":{"command":"npm","args":["run","test:e2e","--","--grep","settings page"],"cwd":"orbit-mini-lab","reason":"verify settings layout"}}');

    expect(parsed.errors).toHaveLength(0);
    expect(parsed.envelopes[0].params).toMatchObject({
      command: "npm",
      args: ["run", "test:e2e", "--", "--grep", "settings page"],
      cwd: "orbit-mini-lab",
      reason: "verify settings layout",
    });
  });

  it("rejects run_command without an explicit reason", () => {
    const parsed = parseToolEnvelopes('{"tool":"run_command","params":{"command":"npm","args":["test"]}}');

    expect(parsed.envelopes).toHaveLength(0);
    expect(parsed.errors.length).toBeGreaterThan(0);
  });

  it("accepts structured ask_user options while preserving legacy defaults", () => {
    const legacy = parseToolEnvelopes('{"tool":"ask_user","params":{"question":"Continue?"}}');
    expect(legacy.errors).toHaveLength(0);
    expect(legacy.envelopes[0]).toEqual({
      tool: "ask_user",
      params: { question: "Continue?", options: [], allowFreeform: false },
    });

    const structured = parseToolEnvelopes(JSON.stringify({
      tool: "ask_user",
      params: {
        question: "Pick a path",
        options: [
          { label: "Safe path", description: "Run tests first.", recommended: true },
        ],
        allowFreeform: true,
      },
    }));
    expect(structured.errors).toHaveLength(0);
    expect(structured.envelopes[0]).toMatchObject({
      tool: "ask_user",
      params: {
        question: "Pick a path",
        options: [{ label: "Safe path", description: "Run tests first.", recommended: true }],
        allowFreeform: true,
      },
    });
  });

  it("accepts nested patch proposals with old and new content", () => {
    const parsed = parseToolEnvelopes('{"tool":"apply_patch","params":{"patches":[{"path":"src/App.tsx","oldContent":"old","newContent":"new"}]}}');

    expect(parsed.errors).toHaveLength(0);
    expect(parsed.envelopes[0].params).toMatchObject({
      patches: [{ path: "src/App.tsx", oldContent: "old", newContent: "new" }],
    });
  });

  it("canonicalizes localized tool aliases before validation", () => {
    const parsed = parseToolEnvelopes('{"tool":"补丁","params":{"patches":[{"path":"src/App.tsx","oldContent":"","newContent":"export {}"}]}}');

    expect(parsed.errors).toHaveLength(0);
    expect(parsed.envelopes[0]).toEqual({
      tool: "apply_patch",
      params: {
        patches: [{ path: "src/App.tsx", oldContent: "", newContent: "export {}" }],
      },
    });
  });

  it("accepts a whole multiline JSON object without markdown fences", () => {
    const parsed = parseToolEnvelopes([
      "{",
      '  "tool": "补丁",',
      '  "params": {',
      '    "patches": [',
      '      { "path": "src/App.tsx", "oldContent": "", "newContent": "export const value = 1;\\n" }',
      "    ]",
      "  }",
      "}",
    ].join("\n"));

    expect(parsed.errors).toHaveLength(0);
    expect(parsed.envelopes[0]).toEqual({
      tool: "apply_patch",
      params: {
        patches: [{ path: "src/App.tsx", oldContent: "", newContent: "export const value = 1;\n" }],
      },
    });
  });

  it("accepts one balanced JSON tool object with an ignorable streaming cursor wrapper", () => {
    const parsed = parseToolEnvelopes(`\n{"tool":"补丁","params":{"patches":[{"path":"src/App.tsx","oldContent":"","newContent":"export const value = 1;"}]}}\n|`);

    expect(parsed.errors).toHaveLength(0);
    expect(parsed.envelopes[0].tool).toBe("apply_patch");
  });

  it("salvages the first reviewable chunk from oversized multi-file patch calls", () => {
    const parsed = parseToolEnvelopes(JSON.stringify({
      tool: "apply_patch",
      params: {
        patches: [
          { path: "a.ts", oldContent: "", newContent: "a" },
          { path: "b.ts", oldContent: "", newContent: "b" },
          { path: "c.ts", oldContent: "", newContent: "c" },
          { path: "d.ts", oldContent: "", newContent: "d" },
        ],
      },
    }));

    expect(parsed.errors).toHaveLength(0);
    expect(parsed.envelopes[0]).toMatchObject({
      tool: "apply_patch",
      params: {
        patches: [
          { path: "a.ts", oldContent: "", newContent: "a" },
          { path: "b.ts", oldContent: "", newContent: "b" },
          { path: "c.ts", oldContent: "", newContent: "c" },
        ],
      },
    });
  });

  it("salvages complete patch objects from truncated apply_patch JSON", () => {
    const parsed = parseToolEnvelopes('{"tool":"apply_patch","params":{"patches":[{"path":"package.json","oldContent":"","newContent":"{\\"name\\":\\"demo\\"}"},{"path":"src/main.ts","oldContent":"","newContent":"export const ok = true;"},{"path":"src/broken.ts","oldContent":"","newContent":"export const broken');

    expect(parsed.errors).toHaveLength(0);
    expect(parsed.envelopes[0]).toEqual({
      tool: "apply_patch",
      params: {
        patches: [
          { path: "package.json", oldContent: "", newContent: '{"name":"demo"}' },
          { path: "src/main.ts", oldContent: "", newContent: "export const ok = true;" },
        ],
      },
    });
  });

  it("rejects patch-like prose that never calls propose_patch", () => {
    const parsed = parseToolEnvelopes([
      "太好了，我现在可以提出所有补丁文件了。",
      '<补丁> { "patches": [{ "path": "src/App.tsx", "oldContent": "", "newContent": "export {}" }] }',
      "Waiting for review in the 审查台.",
    ].join("\n"));

    expect(parsed.envelopes).toHaveLength(0);
    expect(parsed.errors.join("\n")).toContain("Patch proposals must use a strict propose_patch tool envelope");
  });
});
