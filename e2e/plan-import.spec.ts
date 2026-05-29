import { test, expect } from "@playwright/test";

test.describe("Orbit Code — Plan Import", () => {
  test("imports checkout-plan.yaml and shows tasks", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    // Find the composer input and paste a plan
    const composer = page.locator(".composer");
    await expect(composer).toBeVisible();

    const textarea = composer.locator("textarea");
    await expect(textarea).toBeVisible();

    // Paste a simple plan
    await textarea.fill(`version: "1"
title: "Test Plan"
goals:
  - "Test goal"
constraints:
  - "Keep the test change local"
tasks:
  - id: task-1
    title: "Test Task"
    description: "Do something"
    status: queued
    dependsOn: []
    filesHint:
      - "src/App.tsx"
    verification:
      - "npm test"
acceptanceCriteria:
  - "The plan summary shows detailed sections"
risks:
  - "Visual regression in the thread summary"
decisionQuestions:
  - question: "Should the plan stay compact?"
    recommended: "Yes, show only decision-level detail in the center thread."
    options:
      - "Yes"
      - "No"
references: []`);

    // Submit (blur or press a button)
    await textarea.press("Enter");
    await page.waitForTimeout(1500);

    // A plan card should appear
    const planCard = page.locator(".plan-card");
    await expect(planCard).toBeVisible({ timeout: 5000 });
    await expect(planCard.getByText("Keep the test change local")).toBeVisible();
    await expect(planCard.getByText("Should the plan stay compact?")).toBeVisible();
    await expect(planCard.getByText("Yes, show only decision-level detail in the center thread.")).toBeVisible();
    await expect(planCard.getByText("The plan summary shows detailed sections")).toBeVisible();
    await expect(planCard.getByText("Visual regression in the thread summary")).toBeVisible();
  });

  test("shift enter keeps a newline in the composer", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    const textarea = page.locator(".composer textarea");
    await textarea.fill("first line");
    await textarea.press("Shift+Enter");
    await textarea.type("second line");

    await expect(textarea).toHaveValue("first line\nsecond line");
    await expect(page.locator(".plan-card")).not.toBeVisible();
  });

  test("imported tasks stay on the center plan surface while review dock remains inspector", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    const textarea = page.locator(".composer textarea");
    await textarea.fill(`version: "1"
title: "Queue Test"
goals: ["Test"]
constraints: []
tasks:
  - id: t1
    title: "Step 1"
    description: "First step"
    status: queued
    dependsOn: []
    filesHint: ["src/App.tsx"]
    verification: ["echo ok"]
acceptanceCriteria: []
risks: []
references: []`);

    await textarea.press("Enter");
    await page.waitForTimeout(2000);

    await expect(page.locator(".plan-card")).toContainText("Step 1", { timeout: 5000 });
    await expect(page.locator(".review-dock")).toBeVisible();
    await expect(page.getByRole("tab", { name: /任务|Tasks/ })).toHaveCount(0);
    await page.getByRole("tab", { name: /变更|Changes/ }).click();
    await expect(page.locator(".review-dock")).not.toContainText("Step 1");
  });
});
