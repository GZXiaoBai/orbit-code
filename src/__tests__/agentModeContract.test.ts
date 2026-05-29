import { describe, expect, it } from "vitest";
import { isToolAllowedInMode } from "../domain/agentModeContract";
import { buildToolRegistry, buildToolsPrompt } from "../runtime/toolRegistry";

describe("agent mode contract", () => {
  it("does not expose command or patch tools in Plan mode", () => {
    const registry = buildToolRegistry("plan");

    expect(Object.keys(registry)).toEqual(["read_file", "list_files", "search_code", "ask_user", "done_plan"]);
    expect(registry.run_command).toBeUndefined();
    expect(registry.apply_patch).toBeUndefined();
    expect(registry.propose_patch).toBeUndefined();
    expect(buildToolsPrompt("plan")).not.toContain("run_command");
    expect(buildToolsPrompt("plan")).not.toContain("propose_patch");
    expect(buildToolsPrompt("plan")).not.toContain("Build mode");
    expect(buildToolsPrompt("plan")).not.toContain("modifying a file");
    expect(buildToolsPrompt("plan")).toContain('"tool": "done_plan"');
  });

  it("exposes executable tools only through Build mode", () => {
    const registry = buildToolRegistry("build");

    expect(Object.keys(registry)).toEqual([
      "read_file",
      "list_files",
      "search_code",
      "run_command",
      "propose_patch",
      "ask_user",
      "done_build",
    ]);
    expect(registry.apply_patch).toBeUndefined();
    expect(registry.done).toBeUndefined();
    expect(registry.run_command?.requiresApproval).toBe(true);
    expect(isToolAllowedInMode("plan", "run_command")).toBe(false);
    expect(isToolAllowedInMode("plan", "apply_patch")).toBe(false);
    expect(isToolAllowedInMode("build", "run_command")).toBe(true);
    expect(isToolAllowedInMode("build", "propose_patch")).toBe(true);
  });
});
