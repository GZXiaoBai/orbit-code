import { test, expect } from "@playwright/test";

test.describe("Orbit Code — Agent run", () => {
  test("agent collaboration timeline activates after plan import", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    // Import a plan first
    const textarea = page.locator(".composer textarea");
    await textarea.fill(`version: "1"
title: "Loop Test"
goals: ["Test agent loop"]
constraints: []
tasks:
  - id: lt1
    title: "Agent Task"
    description: "Test agent autonomous execution"
    status: queued
    dependsOn: []
    filesHint: ["src/App.tsx"]
    verification: ["echo 'agent test'"]
acceptanceCriteria: []
risks: []
references: []`);

    await textarea.press("Enter");
    await page.waitForTimeout(2000);

    await expect(page.locator(".plan-card")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".plan-card")).toContainText("Agent Task");
    await expect(page.locator("button:has-text('Agent run')")).toHaveCount(0);
    await expect(page.locator("button:has-text('开始执行')")).toHaveCount(0);
  });

  test("agent loop button exists and is clickable", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    // Import plan
    const textarea = page.locator(".composer textarea");
    await textarea.fill(`version: "1"
title: "Button Test"
goals: ["Button test"]
constraints: []
tasks:
  - id: bt1
    title: "Button Task"
    description: "Test button"
    status: queued
    dependsOn: []
    filesHint: ["src/App.tsx"]
    verification: ["echo ok"]
acceptanceCriteria: []
risks: []
references: []`);

    await textarea.press("Enter");
    await page.waitForTimeout(2000);

    await page.locator(".run-control-bar").getByRole("button", { name: /Build/ }).click();

    // The localized Agent run button should be visible.
    await expect(page.locator("button:has-text('Agent run')")).toHaveCount(0);
    const loopBtn = page.getByRole("button", { name: "开始执行" });
    await expect(loopBtn).toBeVisible({ timeout: 5000 });
  });

  test("plan import does not fabricate a diff without a configured model", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    const textarea = page.locator(".composer textarea");
    await textarea.fill(`version: "1"
title: "No Fake Diff Test"
goals: ["Do not fabricate diffs"]
constraints: []
tasks:
  - id: dt1
    title: "Diff Task"
    description: "Test diff rendering"
    status: queued
    dependsOn: []
    filesHint: ["src/App.tsx"]
    verification: ["echo test"]
acceptanceCriteria: []
risks: []
references: []`);

    await textarea.press("Enter");
    await page.waitForTimeout(2000);

    await expect(page.locator(".agent-collaboration-timeline")).toBeVisible();
    await expect(page.locator(".timeline-node.role-coder")).toHaveCount(0);
    await expect(page.locator(".diff-filename")).toHaveCount(0);
  });
});
