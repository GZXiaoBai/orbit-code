import { describe, expect, it } from "vitest";
import { classifyCommand } from "../runtime/approvalPolicy";
import type { ProjectSecurityOverride, SecuritySettings } from "../domain/types";

describe("classifyCommand", () => {
  it("allows low-risk read commands once", () => {
    expect(classifyCommand("git status --short")).toBe("allow_once");
    expect(classifyCommand("rg checkout src")).toBe("allow_once");
  });

  it("asks before dependency changes", () => {
    expect(classifyCommand("pnpm add zod")).toBe("ask");
  });

  it("denies obviously dangerous commands", () => {
    expect(classifyCommand("rm -rf /")).toBe("deny");
    expect(classifyCommand("cat .env")).toBe("deny");
  });

  it("applies global security presets", () => {
    const security: SecuritySettings = {
      preset: "readOnly",
      advancedRules: {},
      sandboxMode: "restricted",
    };

    expect(classifyCommand("npm test", security)).toBe("deny");
    expect(classifyCommand("rg Button src", security)).toBe("allow_once");
  });

  it("lets project overrides take priority over global defaults", () => {
    const security: SecuritySettings = {
      preset: "readOnly",
      advancedRules: {},
      sandboxMode: "restricted",
    };
    const project: ProjectSecurityOverride = {
      workspacePath: "/tmp/project",
      preset: "fullAccess",
      updatedAt: "2026-05-25T00:00:00.000Z",
    };

    expect(classifyCommand("npm test", security, project)).toBe("allow_once");
  });

  it("keeps dangerous command deny above full access", () => {
    const security: SecuritySettings = {
      preset: "fullAccess",
      advancedRules: {},
      sandboxMode: "none",
    };

    expect(classifyCommand("sudo rm -rf /tmp/example", security)).toBe("deny");
  });
});
