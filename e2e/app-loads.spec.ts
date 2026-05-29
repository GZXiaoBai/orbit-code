import { test, expect } from "@playwright/test";

test.describe("Orbit Code — App Loads", () => {
  test("page loads with title and shell layout", async ({ page }) => {
    await page.goto("/");

    // Brand should be visible
    await expect(page.locator(".workbench-mark")).toHaveText("OC");
    await expect(page.locator(".workbench-header")).toBeVisible();

    // Loading screen should resolve to workbench shell
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".workbench-grid")).toHaveCSS("gap", "0px");
  });

  test("sidebar renders with file tree", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    // Sidebar should exist
    const rail = page.locator(".project-rail");
    await expect(rail).toBeVisible();

    // Should have settings button
    await expect(rail.locator("button")).not.toHaveCount(0);
  });

  test("theme toggle switches between light and dark", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    const themeToggle = page.getByRole("button", { name: "切换主题" });
    await expect(themeToggle).toBeVisible();

    // Default theme should be dark
    const appShell = page.locator(".workbench-shell");
    await expect(appShell).toHaveAttribute("data-theme", "dark");

    // Click to toggle
    await themeToggle.click();
    await expect(appShell).toHaveAttribute("data-theme", "light");

    // Toggle back
    await themeToggle.click();
    await expect(appShell).toHaveAttribute("data-theme", "dark");
  });

  test("language toggle updates the main visible labels", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    await expect(page.locator(".thread-canvas-header h1")).toHaveText("打开项目或导入计划开始");
    await page.locator(".workbench-header-actions").getByRole("button", { name: "切换语言" }).click();

    await expect(page.locator(".thread-canvas-header h1")).toHaveText("Open a project or import a plan");
    await expect(page.getByText("Inspector")).toBeVisible();
    await expect(page.locator(".workbench-project-chip").getByText("Current project")).toBeVisible();
  });

  test("review dock can be hidden and command palette opens", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    await expect(page.locator(".review-dock")).toBeVisible();
    await page.getByRole("button", { name: "隐藏详情检查器" }).click();
    await expect(page.locator(".review-dock")).toHaveCount(0);

    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await expect(page.locator(".command-palette")).toBeVisible();
    await expect(page.getByPlaceholder("搜索项目、文件、设置或命令")).toBeVisible();
  });

  test("settings opens as an independent workspace and returns to app", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    await page.locator(".workbench-header-actions").getByRole("button", { name: "设置" }).click();
    await expect(page.locator(".settings-workspace")).toBeVisible();
    await expect(page.locator(".settings-overlay")).toHaveCount(0);
    await page.getByRole("button", { name: /返回应用/ }).click();
    await expect(page.locator(".workbench-shell")).toBeVisible();
  });
});
