import { test, expect } from "@playwright/test";

const fixtureWorkspace = "/Users/zhoujunjie/PersonalProjects/AinimePlayer";
const fixtureFiles = [
  "CHANGELOG.md",
  "Dockerfile",
  "LICENSE",
  "README.md",
  "THIRD_PARTY.md",
  "analysis_options.yaml",
  "bin/server.dart",
  "bin/test_gpjda_sniff.dart",
  "desktop/main.js",
  "desktop/preload.js",
  "docker-compose.yml",
  "docs/SECURITY.md",
  "docs/api-v2.md",
  "docs/player-api.md",
  ...Array.from({ length: 80 }, (_, index) => `docs/superpowers/specs/2026-05-${String(index + 1).padStart(2, "0")}.md`),
];

async function installDesktopFixture(page: import("@playwright/test").Page) {
  await page.addInitScript(({ workspacePath, files }) => {
    const fileStore: Record<string, string> = {};
    for (const path of files) {
      fileStore[path] = `# ${path}\nfixture preview`;
    }
    (window as any).__AGENT_GUI_DESKTOP_FIXTURE_LOG__ = [];
    (window as any).__AGENT_GUI_DESKTOP_FIXTURE_MUTATE__ = (path: string, content: string) => {
      fileStore[path] = content;
    };
    (window as any).__AGENT_GUI_DESKTOP_FIXTURE__ = {
      async invoke(command: string, args?: Record<string, unknown>) {
        (window as any).__AGENT_GUI_DESKTOP_FIXTURE_LOG__.push(command);
        if (command === "set_workspace_root") return String(args?.path || workspacePath);
        if (command === "get_workspace_root") return workspacePath;
        if (command === "list_workspace_files") return Object.keys(fileStore);
        if (command === "read_workspace_file") {
          const path = String(args?.path || "file");
          if (!(path in fileStore)) throw new Error(`missing fixture file: ${path}`);
          return fileStore[path];
        }
        if (command === "list_projects") return [];
        if (command === "create_project") return null;
        if (command === "run_command_async") return null;
        if (command === "resolve_patch_conflict") {
          const path = String(args?.path || "");
          const oldContent = String(args?.oldContent ?? "");
          const newContent = String(args?.newContent ?? "");
          const diskContent = fileStore[path] ?? "";
          if (diskContent !== oldContent) {
            return {
              success: false,
              merged_content: `<<<<<<< AI\n${newContent}\n=======\n${diskContent}\n>>>>>>> LOCAL\n`,
              has_conflict: true,
            };
          }
          return {
            success: true,
            merged_content: newContent,
            has_conflict: false,
          };
        }
        if (command === "apply_workspace_patches_transactional") {
          const patches = Array.isArray(args?.patches) ? args?.patches as Array<Record<string, unknown>> : [];
          for (const patch of patches) {
            const path = String(patch.path || "");
            if (!path || path.includes("..")) throw new Error("invalid path");
            const oldContent = String(patch.old_content ?? "");
            if (oldContent && fileStore[path] !== oldContent) throw new Error(`stale content for ${path}`);
          }
          for (const patch of patches) {
            const path = String(patch.path || "");
            fileStore[path] = String(patch.new_content ?? "");
          }
          return null;
        }
        throw new Error(`Unhandled fixture command: ${command}`);
      },
    };
  }, { workspacePath: fixtureWorkspace, files: fixtureFiles });
}

function channelFromCssColor(value: string, index: number) {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) return 0;
  const parts = match[1].split(",").map((part) => Number(part.trim().replace("%", "")));
  return parts[index] ?? 0;
}

function alphaFromCssColor(value: string) {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) return 1;
  const parts = match[1].split(",").map((part) => Number(part.trim()));
  return parts.length >= 4 ? parts[3] : 1;
}

const samplePlan = `version: "1"
title: "Plan Only"
goals: ["Keep planning only"]
constraints: []
tasks:
  - id: p1
    title: "Plan step"
    description: "Do not execute yet"
    status: queued
    dependsOn: []
    filesHint: ["src/App.tsx"]
    verification: ["npm test"]
acceptanceCriteria: []
risks: []
references: []`;

const questionPlan = `version: "1"
title: "Ask User Fixture"
goals: ["Exercise ask_user"]
constraints: []
tasks:
  - id: q1
    title: "Ask fixture"
    description: "ASK_USER_FIXTURE"
    status: queued
    dependsOn: []
    filesHint: ["package.json"]
    verification: ["npm test"]
acceptanceCriteria: []
risks: []
references: []`;

async function importFixtureProvider(page: import("@playwright/test").Page) {
  await page.locator(".workbench-header-actions").getByRole("button", { name: "设置" }).click();
  await page.getByRole("button", { name: "模型", exact: true }).click();
  await page.getByRole("button", { name: /Fixture/ }).click();
  await page.getByRole("button", { name: /导入模型|Import models/ }).click();
  await expect(page.getByText(/已导入 1 个模型|Imported 1 models/)).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: /返回应用|Back to app/ }).click();
}

async function startFixtureBuild(page: import("@playwright/test").Page, plan = samplePlan) {
  await importFixtureProvider(page);
  await page.locator(".composer textarea").fill(plan);
  await page.locator(".composer textarea").press("Enter");
  await expect(page.locator(".plan-card")).toBeVisible({ timeout: 5000 });
  await page.locator(".run-control-bar").getByRole("button", { name: /Build/ }).click();
  await page.getByRole("button", { name: /Agent Loop/ }).click();
  await page.getByRole("tab", { name: /Changes/ }).click();
}

test.describe("Orbit Code — Run Controls", () => {
  test("composer hides concrete models until a provider is imported", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    const composer = page.locator(".composer");
    const controls = composer.locator(".run-control-bar");
    await expect(controls).toBeVisible();
    await expect(controls.getByRole("button", { name: /Plan/ })).toBeVisible();
    await expect(controls.getByRole("button", { name: /Build/ })).toBeVisible();
    await expect(controls.getByRole("button", { name: "添加模型" })).toBeVisible();
    await expect(controls.locator("select")).toHaveCount(0);
    await expect(composer.getByText("服务商")).toHaveCount(0);
    await expect(composer.getByPlaceholder("输入模型名")).toHaveCount(0);
  });

  test("settings model page shows provider import entries instead of preset model toggles", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    await page.locator(".workbench-header-actions").getByRole("button", { name: "设置" }).click();
    await page.getByRole("button", { name: "模型", exact: true }).click();
    await expect(page.getByText("服务商", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /OpenAI/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /DeepSeek/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /导入模型/ })).toBeVisible();
    await expect(page.locator(".model-toggle-row", { hasText: "gpt-5" })).toHaveCount(0);
  });

  test("settings exposes mature sections and composer shows project permission", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    await expect(page.locator(".project-permission-chip")).toBeVisible();
    await page.getByRole("button", { name: "当前项目权限" }).click();
    await expect(page.locator(".settings-workspace")).toBeVisible();
    await expect(page.getByText("全局默认权限", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /返回应用/ }).click();

    await page.locator(".workbench-header-actions").getByRole("button", { name: "设置" }).click();
    const settingsNav = page.locator(".settings-workspace-sidebar");
    for (const label of ["常规", "外观", "模型", "安全", "Agent", "项目", "键盘快捷键", "使用情况", "高级"]) {
      await expect(settingsNav.getByRole("button", { name: new RegExp(label) })).toBeVisible();
    }
    await expect(settingsNav.getByRole("button", { name: /MCP 服务器/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /保存配置|Save settings/ })).toHaveCount(0);

    await settingsNav.getByRole("button", { name: "安全", exact: true }).click();
    await expect(page.getByText("全局默认权限", { exact: true })).toBeVisible();
    await expect(page.getByText("高级权限", { exact: true })).toBeVisible();
    await expect(page.locator(".permission-row")).toHaveCount(7);
  });

  test("opened desktop workspace keeps composer visible and enables project permission menu", async ({ page }) => {
    await installDesktopFixture(page);
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "手动路径" }).click();
    await page.getByPlaceholder(/输入本地项目目录/).fill(fixtureWorkspace);
    await page.getByRole("button", { name: "应用" }).click();

    await expect(page.locator(".workbench-project-chip strong")).toContainText("AinimePlayer");
    await expect(page.locator(".file-tree-node.directory", { hasText: "docs" })).toBeVisible();
    await expect(page.locator(".file-tree-node.file", { hasText: "README.md" })).toBeVisible();
    await expect(page.locator(".file-tree-node.file", { hasText: "player-api.md" })).toHaveCount(0);
    await page.locator(".file-tree-node.directory", { hasText: "docs" }).click();
    await expect(page.locator(".file-tree-node.file", { hasText: "player-api.md" })).toBeVisible();

    const composer = page.locator(".composer");
    await expect(composer).toBeVisible();
    const composerBox = await composer.boundingBox();
    expect(composerBox).not.toBeNull();
    expect((composerBox?.y || 0) + (composerBox?.height || 0)).toBeLessThanOrEqual(920);

    await page.getByRole("button", { name: "当前项目权限" }).click();
    await expect(page.locator(".project-permission-menu")).toBeVisible();
    await page.getByRole("menuitemradio", { name: "只读" }).click();
    await expect(page.getByRole("button", { name: "当前项目权限" })).toContainText("只读");

    const firstVisibleFile = page.locator(".file-tree-node").first();
    await expect(firstVisibleFile).toBeVisible();
    await page.locator(".file-tree-list").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(page.locator(".file-tree-node").last()).toBeVisible();
    await expect(composer).toBeVisible();
  });

  test("file tree search opens Monaco read-only preview and large files fall back safely", async ({ page }) => {
    await installDesktopFixture(page);
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "手动路径" }).click();
    await page.getByPlaceholder(/输入本地项目目录/).fill(fixtureWorkspace);
    await page.getByRole("button", { name: "应用" }).click();

    await page.getByPlaceholder("搜索文件").fill("player-api");
    const playerApi = page.locator(".file-tree-node.file", { hasText: "player-api.md" });
    await expect(playerApi).toBeVisible();
    await expect(playerApi.locator("mark")).toBeVisible();
    await playerApi.click();

    await expect(page.locator("[data-testid='monaco-readonly-preview']")).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("[data-testid='monaco-readonly-preview']")).toContainText("只读预览");
    await expect(page.getByRole("button", { name: /保存|Save/ })).toHaveCount(0);

    await page.evaluate(() => {
      const lines = Array.from({ length: 20_050 }, (_, index) => `export const line${index} = ${index};`).join("\n");
      (window as any).__AGENT_GUI_DESKTOP_FIXTURE_MUTATE__("docs/huge.ts", lines);
    });
    await page.getByRole("button", { name: "刷新文件树" }).click();
    await page.getByPlaceholder("搜索文件").fill("huge");
    await page.locator(".file-tree-node.file", { hasText: "huge.ts" }).click();
    await expect(page.locator(".large-file-preview")).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".large-file-preview")).toContainText("文件较大");
  });

  test("light theme keeps usage popover and primary hover readable", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("agent-gui.app-preferences.v1", JSON.stringify({ language: "zh", theme: "light" }));
    });
    await installDesktopFixture(page);
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "手动路径" }).click();
    await page.getByPlaceholder(/输入本地项目目录/).fill(fixtureWorkspace);
    await page.getByRole("button", { name: "应用" }).click();

    const usageButton = page.getByRole("button", { name: "本地使用情况" });
    await usageButton.click();
    const popover = page.locator(".rail-usage-popover");
    await expect(popover).toBeVisible();
    const popoverBackground = await popover.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(alphaFromCssColor(popoverBackground)).toBeGreaterThanOrEqual(0.94);

    const openFolderButton = page.getByRole("button", { name: "打开文件夹" });
    await openFolderButton.hover();
    const hoverColors = await openFolderButton.evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: style.color, background: style.backgroundColor };
    });
    expect(channelFromCssColor(hoverColors.color, 0)).toBeGreaterThan(220);
    expect(channelFromCssColor(hoverColors.background, 0)).toBeLessThan(60);
  });

  test("models settings page is left aligned and compact", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    await page.locator(".workbench-header-actions").getByRole("button", { name: "设置" }).click();
    await page.getByRole("button", { name: "模型", exact: true }).click();

    const sidebarBox = await page.locator(".settings-workspace-sidebar").boundingBox();
    const providerBox = await page.locator(".provider-list-panel").boundingBox();
    const detailBox = await page.locator(".settings-detail-panel").boundingBox();
    expect(sidebarBox).not.toBeNull();
    expect(providerBox).not.toBeNull();
    expect(detailBox).not.toBeNull();
    expect((providerBox?.x || 0) - ((sidebarBox?.x || 0) + (sidebarBox?.width || 0))).toBeLessThanOrEqual(64);
    expect(detailBox?.width || 0).toBeLessThanOrEqual(700);
    await expect(page.locator(".provider-import-hero")).toBeVisible();
  });

  test("Shift+Tab toggles Plan and Build only from the thread surface", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    const activeMode = page.locator(".run-mode-switch button.active");
    await expect(activeMode).toContainText("Plan");

    await page.locator(".composer textarea").focus();
    await page.keyboard.press("Shift+Tab");
    await expect(activeMode).toContainText("Build");

    await page.locator(".workbench-header-actions").getByRole("button", { name: "设置" }).click();
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator(".settings-workspace")).toBeVisible();
  });

  test("thread actions menu opens, toggles review dock, and closes on outside click", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "线程操作" }).click();
    await expect(page.locator(".thread-actions-menu")).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "复制线程摘要" })).toBeVisible();

    await page.getByRole("menuitem", { name: "隐藏审查台" }).click();
    await expect(page.locator(".review-dock")).toHaveCount(0);

    await page.getByRole("button", { name: "线程操作" }).click();
    await page.mouse.click(20, 80);
    await expect(page.locator(".thread-actions-menu")).toHaveCount(0);
  });

  test("plan mode import only prepares tasks and does not create diffs", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    await page.locator(".run-control-bar").getByRole("button", { name: /Plan/ }).click();
    const textarea = page.locator(".composer textarea");
    await textarea.fill(samplePlan);
    await textarea.press("Enter");

    await expect(page.locator(".plan-card")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".dock-diff-card")).not.toBeVisible();
  });

  test("build mode without an API key reports missing configuration instead of fake diffs", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    await page.locator(".composer textarea").fill(samplePlan);
    await page.locator(".composer textarea").press("Enter");
    await expect(page.locator(".plan-card")).toBeVisible({ timeout: 5000 });

    await page.locator(".run-control-bar").getByRole("button", { name: /Build/ }).click();
    await page.getByRole("button", { name: /Agent Loop/ }).click();
    await expect(page.locator(".agent-collaboration-timeline")).toContainText("当前没有可用模型");
    await expect(page.locator(".dock-diff-card")).not.toBeVisible();
  });

  test("fixture provider drives command approval, terminal result, and patch review", async ({ page }) => {
    await installDesktopFixture(page);
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    await page.locator(".workbench-header-actions").getByRole("button", { name: "设置" }).click();
    await page.getByRole("button", { name: "模型", exact: true }).click();
    await page.getByRole("button", { name: /Fixture/ }).click();
    await page.getByRole("button", { name: /导入模型|Import models/ }).click();
    await expect(page.getByText(/已导入 1 个模型|Imported 1 models/)).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /测试连接|Test connection/ }).click();
    await expect(page.locator(".import-status-chip.smokePassed")).toContainText(/连接可用|Connection ready/, { timeout: 5000 });
    await page.getByRole("button", { name: /返回应用|Back to app/ }).click();

    await expect(page.locator(".run-control-bar")).toContainText("fixture-coder");

    await page.locator(".composer textarea").fill(samplePlan);
    await page.locator(".composer textarea").press("Enter");
    await expect(page.locator(".plan-card")).toBeVisible({ timeout: 5000 });

    await page.locator(".run-control-bar").getByRole("button", { name: /Build/ }).click();
    await page.getByRole("button", { name: /Agent Loop/ }).click();

    await page.getByRole("tab", { name: /Changes/ }).click();
    await expect(page.locator(".approval-request-card", { hasText: "run_command" })).toBeVisible({ timeout: 10000 });
    await page.locator(".approval-request-card", { hasText: "run_command" }).getByRole("button", { name: /批准|Approve/ }).click();

    await page.getByRole("tab", { name: /Terminal/ }).click();
    await expect(page.locator(".dock-terminal")).toContainText("Desktop runtime required", { timeout: 10000 });

    await page.getByRole("tab", { name: /Changes/ }).click();
    await expect(page.locator(".dock-diff-card")).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".dock-diff-card")).toContainText(/Sandbox sandboxed|Sandbox failed/);
    await expect(page.locator(".dock-diff-card")).toContainText("AGENT_GUI_FIXTURE.md");

    await page.locator(".dock-diff-card .apply-patch-action-btn").click();
    await expect.poll(() => page.evaluate(() => (window as any).__AGENT_GUI_DESKTOP_FIXTURE_LOG__ || [])).toContain("apply_workspace_patches_transactional");
    await expect(page.locator(".dock-applied-history")).toContainText(/所有修改已安全应用到本地|All changes have been applied locally/, { timeout: 10000 });
    await expect(page.locator(".approval-request-card", { hasText: "npm test" })).toBeVisible({ timeout: 10000 });

    await page.getByRole("tab", { name: /Files/ }).click();
    await page.getByPlaceholder("搜索文件").fill("AGENT_GUI_FIXTURE");
    await page.locator(".file-tree-node.file", { hasText: "AGENT_GUI_FIXTURE.md" }).click();
    await expect(page.locator("[data-testid='monaco-readonly-preview']")).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 10000 });
  });

  test("pending command approval survives reload and approve executes local resume action", async ({ page }) => {
    await installDesktopFixture(page);
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "手动路径" }).click();
    await page.getByPlaceholder(/输入本地项目目录/).fill(fixtureWorkspace);
    await page.getByRole("button", { name: "应用" }).click();
    await startFixtureBuild(page);

    const approval = page.locator(".approval-request-card", { hasText: "run_command" });
    await expect(approval).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2300);
    await page.reload();
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });
    await page.getByRole("tab", { name: /Changes/ }).click();

    const recoveredApproval = page.locator(".approval-request-card", { hasText: "run_command" });
    await expect(recoveredApproval).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".agent-collaboration-timeline")).toContainText(/已恢复等待操作|Recovered Waiting State/, { timeout: 10000 });
    await recoveredApproval.getByRole("button", { name: /批准|Approve/ }).click();

    await expect.poll(() => page.evaluate(() => (window as any).__AGENT_GUI_DESKTOP_FIXTURE_LOG__ || [])).toContain("run_command_async");
    await page.getByRole("tab", { name: /Terminal/ }).click();
    await expect(page.locator(".dock-terminal")).toContainText("npm test", { timeout: 5000 });
  });

  test("pending question survives reload and records recovered answer", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });
    await startFixtureBuild(page, questionPlan);

    const questionCard = page.locator(".question-request-card");
    await expect(questionCard).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2300);
    await page.reload();
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });
    await page.getByRole("tab", { name: /Changes/ }).click();

    const recoveredQuestion = page.locator(".question-request-card");
    await expect(recoveredQuestion).toBeVisible({ timeout: 10000 });
    await recoveredQuestion.locator("textarea").fill("Use the recovered fixture answer.");
    await recoveredQuestion.getByRole("button", { name: /回答|Answer/ }).click();
    await expect(page.locator(".agent-collaboration-timeline")).toContainText(/恢复的问题|Recovered Question Answered|recovered fixture answer/i, { timeout: 10000 });
  });

  test("pending patch review survives reload and can apply transactionally", async ({ page }) => {
    await installDesktopFixture(page);
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "手动路径" }).click();
    await page.getByPlaceholder(/输入本地项目目录/).fill(fixtureWorkspace);
    await page.getByRole("button", { name: "应用" }).click();
    await startFixtureBuild(page);

    await page.locator(".approval-request-card", { hasText: "run_command" }).getByRole("button", { name: /批准|Approve/ }).click();
    await expect(page.locator(".dock-diff-card")).toContainText("AGENT_GUI_FIXTURE.md", { timeout: 10000 });
    await page.waitForTimeout(2300);
    await page.reload();
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });
    await page.getByRole("tab", { name: /Changes/ }).click();

    await expect(page.locator(".dock-diff-card")).toContainText("AGENT_GUI_FIXTURE.md", { timeout: 10000 });
    await page.locator(".dock-diff-card .apply-patch-action-btn").click();
    await expect.poll(() => page.evaluate(() => (window as any).__AGENT_GUI_DESKTOP_FIXTURE_LOG__ || [])).toContain("apply_workspace_patches_transactional");
    await expect(page.locator(".approval-request-card", { hasText: "npm test" })).toBeVisible({ timeout: 10000 });
  });

  test("Ollama imported models remain discovery-only and cannot start Build", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    await page.locator(".workbench-header-actions").getByRole("button", { name: "设置" }).click();
    await page.getByRole("button", { name: "模型", exact: true }).click();
    await page.getByRole("button", { name: /Ollama/ }).click();
    await page.getByRole("button", { name: /导入模型|Import models/ }).click();
    await expect(page.locator(".import-inline-message")).toContainText(/已导入|Imported/, { timeout: 5000 });
    await page.getByRole("button", { name: /返回应用|Back to app/ }).click();

    await page.locator(".run-control-bar").getByRole("button", { name: /Build/ }).click();
    await expect(page.locator(".run-control-bar")).toContainText(/暂未接入|not connected|unsupported/i);
    await page.locator(".composer textarea").fill(samplePlan);
    await page.locator(".composer textarea").press("Enter");
    await page.getByRole("button", { name: /Agent Loop/ }).click();
    await expect(page.locator(".agent-collaboration-timeline")).toContainText(/Ollama 当前仅接入|Ollama/, { timeout: 10000 });
    await expect(page.locator(".dock-diff-card")).toHaveCount(0);
  });

  test("fixture provider ask_user flow waits for an answer in Review Dock", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    await page.locator(".workbench-header-actions").getByRole("button", { name: "设置" }).click();
    await page.getByRole("button", { name: "模型", exact: true }).click();
    await page.getByRole("button", { name: /Fixture/ }).click();
    await page.getByRole("button", { name: /导入模型|Import models/ }).click();
    await expect(page.getByText(/已导入 1 个模型|Imported 1 models/)).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /返回应用|Back to app/ }).click();

    await page.locator(".composer textarea").fill(questionPlan);
    await page.locator(".composer textarea").press("Enter");
    await expect(page.locator(".plan-card")).toBeVisible({ timeout: 5000 });

    await page.locator(".run-control-bar").getByRole("button", { name: /Build/ }).click();
    await page.getByRole("button", { name: /Agent Loop/ }).click();

    await page.getByRole("tab", { name: /Changes/ }).click();
    const questionCard = page.locator(".question-request-card");
    await expect(questionCard).toBeVisible({ timeout: 10000 });
    await expect(questionCard).toContainText(/Which implementation path|Agent/);
    await questionCard.locator("textarea").fill("Use the safe fixture path.");
    await questionCard.getByRole("button", { name: /回答|Answer/ }).click();
    await expect(page.locator(".agent-collaboration-timeline")).toContainText(/回答|answered/i, { timeout: 10000 });
  });

  test("patch apply stops on local conflict and writes only after resolution", async ({ page }) => {
    await installDesktopFixture(page);
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    await page.locator(".workbench-header-actions").getByRole("button", { name: "设置" }).click();
    await page.getByRole("button", { name: "模型", exact: true }).click();
    await page.getByRole("button", { name: /Fixture/ }).click();
    await page.getByRole("button", { name: /导入模型|Import models/ }).click();
    await expect(page.getByText(/已导入 1 个模型|Imported 1 models/)).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /返回应用|Back to app/ }).click();

    await page.locator(".composer textarea").fill(samplePlan);
    await page.locator(".composer textarea").press("Enter");
    await page.locator(".run-control-bar").getByRole("button", { name: /Build/ }).click();
    await page.getByRole("button", { name: /Agent Loop/ }).click();

    await page.getByRole("tab", { name: /Changes/ }).click();
    await page.locator(".approval-request-card", { hasText: "run_command" }).getByRole("button", { name: /批准|Approve/ }).click();
    await expect(page.locator(".dock-diff-card")).toContainText("AGENT_GUI_FIXTURE.md", { timeout: 10000 });

    await page.evaluate(() => {
      (window as any).__AGENT_GUI_DESKTOP_FIXTURE_MUTATE__("AGENT_GUI_FIXTURE.md", "# Local Change\n\nUser edited this before approving.\n");
    });

    await page.locator(".dock-diff-card .apply-patch-action-btn").click();
    await expect(page.locator(".dock-diff-card")).toContainText(/3-Way Merge|3-way merge|冲突/, { timeout: 10000 });
    await expect.poll(() => page.evaluate(() => {
      const log = (window as any).__AGENT_GUI_DESKTOP_FIXTURE_LOG__ || [];
      return log.filter((entry: string) => entry === "apply_workspace_patches_transactional").length;
    })).toBe(0);

    await page.getByRole("button", { name: /解决冲突|Resolve/ }).click();
    await page.locator(".dock-diff-card .apply-patch-action-btn").click();
    await expect.poll(() => page.evaluate(() => {
      const log = (window as any).__AGENT_GUI_DESKTOP_FIXTURE_LOG__ || [];
      return log.filter((entry: string) => entry === "apply_workspace_patches_transactional").length;
    })).toBe(1);
    await expect(page.locator(".dock-applied-history")).toContainText(/所有修改已安全应用到本地|All changes have been applied locally/, { timeout: 10000 });
  });

  test("fixture provider command denial does not create terminal output", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    await page.locator(".workbench-header-actions").getByRole("button", { name: "设置" }).click();
    await page.getByRole("button", { name: "模型", exact: true }).click();
    await page.getByRole("button", { name: /Fixture/ }).click();
    await page.getByRole("button", { name: /导入模型|Import models/ }).click();
    await expect(page.getByText(/已导入 1 个模型|Imported 1 models/)).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /返回应用|Back to app/ }).click();

    await page.locator(".composer textarea").fill(samplePlan);
    await page.locator(".composer textarea").press("Enter");
    await expect(page.locator(".plan-card")).toBeVisible({ timeout: 5000 });

    await page.locator(".run-control-bar").getByRole("button", { name: /Build/ }).click();
    await page.getByRole("button", { name: /Agent Loop/ }).click();

    await page.getByRole("tab", { name: /Changes/ }).click();
    const approval = page.locator(".approval-request-card", { hasText: "run_command" });
    await expect(approval).toBeVisible({ timeout: 10000 });
    await approval.getByRole("button", { name: /拒绝|Deny/ }).click();

    await expect(page.locator(".agent-collaboration-timeline")).toContainText(/拒绝|denied/i, { timeout: 10000 });
    await page.getByRole("tab", { name: /Terminal/ }).click();
    await expect(page.locator(".dock-terminal")).toHaveCount(0);
  });
});
