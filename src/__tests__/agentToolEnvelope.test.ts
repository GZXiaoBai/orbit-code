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
    const parsed = parseToolEnvelopes('{"tool":"run_command","params":{"command":"npm","args":["run","test:e2e","--","--grep","settings page"],"reason":"verify settings layout"}}');

    expect(parsed.errors).toHaveLength(0);
    expect(parsed.envelopes[0].params).toMatchObject({
      command: "npm",
      args: ["run", "test:e2e", "--", "--grep", "settings page"],
      reason: "verify settings layout",
    });
  });

  it("rejects run_command without an explicit reason", () => {
    const parsed = parseToolEnvelopes('{"tool":"run_command","params":{"command":"npm","args":["test"]}}');

    expect(parsed.envelopes).toHaveLength(0);
    expect(parsed.errors.length).toBeGreaterThan(0);
  });

  it("accepts nested patch proposals with old and new content", () => {
    const parsed = parseToolEnvelopes('{"tool":"apply_patch","params":{"patches":[{"path":"src/App.tsx","oldContent":"old","newContent":"new"}]}}');

    expect(parsed.errors).toHaveLength(0);
    expect(parsed.envelopes[0].params).toMatchObject({
      patches: [{ path: "src/App.tsx", oldContent: "old", newContent: "new" }],
    });
  });
});
