import { describe, expect, it } from "vitest";
import { rejectExecutableHook, LoggingHookAdapter } from "../runtime/hookAdapter";
import { parseSkillManifest, skillManifestContext } from "../runtime/skillManifest";

describe("controlled extension adapters", () => {
  it("keeps first hook adapter record-only and rejects executable wording", async () => {
    const adapter = new LoggingHookAdapter();
    const result = await adapter.invoke({ kind: "beforePlan", message: "Remember project constraints." });

    expect(result.status).toBe("recorded");
    expect(rejectExecutableHook("run npm install before build")).toBe(true);
    expect(rejectExecutableHook("prefer small patches")).toBe(false);
  });

  it("parses skill manifests as read-only context", () => {
    const parsed = parseSkillManifest(JSON.stringify({
      id: "mini-review",
      name: "Mini Review",
      description: "Review small patches.",
      instructions: "Check tests.",
    }));

    expect(parsed.ok).toBe(true);
    expect(skillManifestContext(parsed.manifest!)).toContain("does not grant extra tools");
  });

  it("parses markdown skill frontmatter with mode restrictions", () => {
    const parsed = parseSkillManifest("---\nname: review\ndescription: Review patches\nmodeSlugs:\n  - plan\n  - build\n---\n\n# Review\nCheck tests.");

    expect(parsed.ok).toBe(true);
    expect(parsed.manifest).toMatchObject({
      id: "review",
      name: "review",
      description: "Review patches",
      modeSlugs: ["plan", "build"],
    });
  });
});
