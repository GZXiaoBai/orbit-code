import { describe, expect, it } from "vitest";
import { isInstallOnlyCommand, selectVerificationCommand } from "../runtime/verificationCommand";

describe("verification command selection", () => {
  it("skips install-only setup commands when a real validation command exists", () => {
    const selected = selectVerificationCommand({
      cwd: "orbit-mini-lab",
      planCommands: ["cd orbit-mini-lab && npm install", "cd orbit-mini-lab && npm run build"],
    });

    expect(selected).toEqual({
      command: "npm",
      args: ["run", "build"],
      cwd: "orbit-mini-lab",
    });
  });

  it("prefers package test:run scripts over setup commands", () => {
    const selected = selectVerificationCommand({
      cwd: "orbit-mini-lab",
      planCommands: ["npm install"],
      packageScripts: {
        test: "vitest",
        "test:run": "vitest run",
        build: "vite build",
      },
    });

    expect(selected).toEqual({
      command: "npm",
      args: ["run", "test:run"],
      cwd: "orbit-mini-lab",
    });
  });

  it("uses a non-watch vitest invocation when only test script exists", () => {
    const selected = selectVerificationCommand({
      cwd: "app",
      packageScripts: { test: "vitest", build: "vite build" },
    });

    expect(selected).toEqual({
      command: "npm",
      args: ["test", "--", "--run"],
      cwd: "app",
    });
  });

  it("classifies package manager install commands as setup, not validation", () => {
    expect(isInstallOnlyCommand({ command: "npm", args: ["install"] })).toBe(true);
    expect(isInstallOnlyCommand({ command: "pnpm", args: ["install"] })).toBe(true);
    expect(isInstallOnlyCommand({ command: "npm", args: ["run", "build"] })).toBe(false);
  });
});
