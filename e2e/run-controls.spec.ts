import { test, expect } from "@playwright/test";

const fixtureWorkspace = "/Users/zhoujunjie/PersonalProjects/AinimePlayer";
const fixtureFiles = [
  "CHANGELOG.md",
  "Dockerfile",
  "LICENSE",
  "package.json",
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
    (window as any).__AGENT_GUI_DESKTOP_FIXTURE_ACTIONS__ = [];
    (window as any).__AGENT_GUI_DESKTOP_FIXTURE_CLIPBOARD__ = "";
    (window as any).__AGENT_GUI_DESKTOP_FIXTURE_SANDBOX_FAIL_ONCE__ = false;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as any).__AGENT_GUI_DESKTOP_FIXTURE_CLIPBOARD__ = text;
        },
      },
    });
    (window as any).__AGENT_GUI_DESKTOP_FIXTURE_MUTATE__ = (path: string, content: string) => {
      fileStore[path] = content;
    };
    (window as any).__AGENT_GUI_DESKTOP_FIXTURE_READ__ = (path: string) => fileStore[path];
    (window as any).__AGENT_GUI_DESKTOP_FIXTURE__ = {
      async invoke(command: string, args?: Record<string, unknown>) {
        (window as any).__AGENT_GUI_DESKTOP_FIXTURE_LOG__.push(command);
        if (command === "set_workspace_root") return String(args?.path || workspacePath);
        if (command === "get_workspace_root") return workspacePath;
        if (command === "list_workspace_files") return Object.keys(fileStore);
        if (command === "search_workspace_files") {
          const query = String(args?.query || "").toLowerCase();
          return Object.entries(fileStore)
            .flatMap(([path, content]) => content.split("\n").map((line, index) => ({ path, line, index })))
            .filter((item) => item.line.toLowerCase().includes(query))
            .slice(0, Number(args?.maxResults || 30))
            .map((item) => `${item.path}:${item.index + 1}:${item.line.trim().slice(0, 160)}`);
        }
        if (command === "read_workspace_file") {
          const path = String(args?.path || "file");
          if (!(path in fileStore)) throw new Error(`missing fixture file: ${path}`);
          return fileStore[path];
        }
        if (command === "write_workspace_context_file") {
          const path = String(args?.path || "");
          if (!path || path.includes("..")) throw new Error("invalid path");
          if (!["ORBIT.md", ".orbit/rules", ".orbit/rules.md"].includes(path) && !/^\.orbit\/skills\/[^/]+\/SKILL\.md$/.test(path)) {
            throw new Error("Context file path is not allowed");
          }
          fileStore[path] = String(args?.content ?? "");
          return null;
        }
        if (command === "list_projects") return [];
        if (command === "create_project") return null;
        if (command === "open_workspace_path") {
          (window as any).__AGENT_GUI_DESKTOP_FIXTURE_ACTIONS__.push(args);
          return null;
        }
        if (command === "run_command_async") return null;
        if (command === "run_command_sync") return "Desktop runtime required for command execution.\n[exit_code: 1]";
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
        if (command === "preview_workspace_patches_in_sandbox") {
          const patches = Array.isArray(args?.patches) ? args?.patches as Array<Record<string, unknown>> : [];
          for (const patch of patches) {
            const path = String(patch.path || "");
            if (!path || path.includes("..")) throw new Error("invalid path");
          }
          if ((window as any).__AGENT_GUI_DESKTOP_FIXTURE_SANDBOX_FAIL_ONCE__) {
            (window as any).__AGENT_GUI_DESKTOP_FIXTURE_SANDBOX_FAIL_ONCE__ = false;
            throw new Error("fixture sandbox preview failed once");
          }
          return {
            id: String(args?.proposalId || "sandbox-fixture"),
            proposal_id: String(args?.proposalId || "sandbox-fixture"),
            sandbox_path: "/tmp/orbit-fixture-sandbox",
            status: "sandboxed",
            output: "Fixture sandbox preview completed. No workspace files were changed.",
            created_at: new Date().toISOString(),
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
        if (command === "restore_workspace_file_snapshot") {
          const filesToRestore = Array.isArray(args?.files) ? args?.files as Array<Record<string, unknown>> : [];
          for (const file of filesToRestore) {
            const path = String(file.path || "");
            if (!path || path.includes("..")) throw new Error("invalid path");
          }
          for (const file of filesToRestore) {
            const path = String(file.path || "");
            if (file.existed === false) {
              delete fileStore[path];
            } else {
              fileStore[path] = String(file.content ?? "");
            }
          }
          return null;
        }
        if (command === "create_workspace_git_shadow_checkpoint") {
          return { checkpoint_id: String(args?.checkpointId || "checkpoint-fixture"), shadow_path: "/tmp/orbit-fixture-shadow" };
        }
        if (command === "restore_workspace_git_shadow_checkpoint") {
          const filesToRestore = Array.isArray(args?.files) ? args?.files as Array<Record<string, unknown>> : [];
          for (const file of filesToRestore) {
            const path = String(file.path || "");
            if (!path || path.includes("..")) throw new Error("invalid path");
            if (file.existed === false) delete fileStore[path];
            else fileStore[path] = String(file.content ?? "");
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

const malformedPatchPlan = `version: "1"
title: "Malformed Patch Fixture"
goals: ["Exercise malformed patch correction"]
constraints: []
tasks:
  - id: malformed-patch
    title: "Malformed patch correction"
    description: "MALFORMED_PATCH_FIXTURE"
    status: queued
    dependsOn: []
    filesHint: ["AGENT_GUI_FIXTURE.md"]
    verification: ["npm test"]
acceptanceCriteria: []
risks: []
references: []`;

const multiFileRollbackPlan = `version: "1"
title: "Multi File Rollback Fixture"
goals: ["Exercise rollback"]
constraints: []
tasks:
  - id: rb1
    title: "Rollback fixture"
    description: "MULTI_FILE_ROLLBACK_FIXTURE"
    status: queued
    dependsOn: []
    filesHint: ["AGENT_GUI_FIXTURE.md", "AGENT_GUI_CREATED.md"]
    verification: ["npm test"]
acceptanceCriteria: []
risks: []
references: []`;

const installApprovalPlan = `version: "1"
title: "Install Approval Fixture"
goals: ["Exercise install approval"]
constraints: []
tasks:
  - id: install-fixture
    title: "Install fixture"
    description: "INSTALL_FIXTURE"
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

async function startFixtureBuild(page: import("@playwright/test").Page, plan = samplePlan, options: { openChanges?: boolean } = {}) {
  const openChanges = options.openChanges ?? true;
  await importFixtureProvider(page);
  await page.locator(".composer textarea").fill(plan);
  await page.locator(".composer textarea").press("Enter");
  await expect(page.locator(".plan-card")).toBeVisible({ timeout: 5000 });
  await page.locator(".run-control-bar").getByRole("button", { name: /Build/ }).click();
  await page.getByRole("button", { name: /开始执行/ }).click();
  if (openChanges) {
    await page.getByRole("tab", { name: /变更|Changes/ }).click();
  }
}

async function approveCurrentOverlay(page: import("@playwright/test").Page) {
  const dialog = page.locator(".approval-dialog");
  await expect(dialog).toBeVisible({ timeout: 10000 });
  await dialog.getByRole("button", { name: /批准|Approve/ }).click();
}

async function openChangesInspector(page: import("@playwright/test").Page) {
  if (await page.locator(".patch-review-overlay").isVisible().catch(() => false)) return;
  await page.getByRole("tab", { name: /变更|Changes/ }).click();
}

async function currentPatchReview(page: import("@playwright/test").Page) {
  const overlay = page.locator(".patch-review-overlay");
  if (await overlay.isVisible().catch(() => false)) return overlay;
  await openChangesInspector(page);
  return page.locator(".dock-diff-card");
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

  test("fixture model import stays free of React update-depth console errors", async ({ page }) => {
    const updateDepthErrors: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (text.includes("Maximum update depth exceeded")) updateDepthErrors.push(text);
    });
    page.on("pageerror", (error) => {
      if (error.message.includes("Maximum update depth exceeded")) updateDepthErrors.push(error.message);
    });

    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });
    await importFixtureProvider(page);
    await page.waitForTimeout(500);

    expect(updateDepthErrors).toEqual([]);
  });

  test("plan composer sends a natural language request through the planner path", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });
    await importFixtureProvider(page);

    await page.locator(".composer textarea").fill("审查项目，制定改进项目的计划");
    await page.locator(".send-button").click();

    await expect(page.locator(".agent-collaboration-timeline")).toContainText(/计划草案|Plan Draft|Fixture planner draft/, { timeout: 5000 });
    await expect(page.locator(".agent-collaboration-timeline")).toContainText(/采纳并进入 Build|Accept and enter Build/);
    await expect(page.locator(".plan-card")).toHaveCount(0);
    await expect(page.locator(".dock-diff-card")).toHaveCount(0);
    await expect(page.locator(".approval-request-card")).toHaveCount(0);
    await expect(page.locator(".composer textarea")).toHaveValue("");
    await expect(page.locator(".plan-import-error")).toHaveCount(0);

    await page.getByRole("button", { name: /采纳并进入 Build|Accept and enter Build/ }).click();
    await expect(page.locator(".plan-card")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".run-control-bar")).toContainText(/Build/);
  });

  test("current context inspector shows read-only ORBIT rules after planner collection", async ({ page }) => {
    await installDesktopFixture(page);
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    await page.evaluate(() => {
      (window as any).__AGENT_GUI_DESKTOP_FIXTURE_MUTATE__("ORBIT.md", "Prefer typed runtime events.");
      (window as any).__AGENT_GUI_DESKTOP_FIXTURE_MUTATE__(".orbit/rules", "Rules never grant tool permissions.");
      (window as any).__AGENT_GUI_DESKTOP_FIXTURE_MUTATE__(".orbit/skills/review/SKILL.md", "---\nname: review\ndescription: Review patches\nmode: plan\n---\n\n# Review\nCheck tests.");
    });
    await page.getByRole("button", { name: "手动路径" }).click();
    await page.getByPlaceholder(/输入本地项目目录/).fill(fixtureWorkspace);
    await page.getByRole("button", { name: "应用" }).click();
    await importFixtureProvider(page);

    await page.locator(".composer textarea").fill("审查项目，制定改进项目的计划");
    await page.locator(".send-button").click();
    await expect(page.locator(".agent-collaboration-timeline")).toContainText(/计划草案|Plan Draft|Fixture planner draft/, { timeout: 5000 });

    await page.getByRole("tab", { name: /上下文|Context/ }).click();
    const inspector = page.getByTestId("current-context-inspector");
    await expect(inspector).toContainText(/当前注入上下文|Current injected context/);
    await expect(inspector).toContainText("ORBIT.md");
    await expect(inspector).toContainText(".orbit/rules");
    await expect(inspector).toContainText("Skill: review");
    await expect(inspector).toContainText(/权限影响|Permission impact/);
    await expect(inspector).toContainText(/无|none/);

    await inspector.getByRole("button", { name: /评估当前线程|Evaluate thread/ }).click();
    await expect(inspector).toContainText(/failed|missing/i);
    await expect(inspector).toContainText("modeSwitch");

    await inspector.locator("textarea").fill("Prefer RuntimeLedger-first context.");
    await inspector.getByRole("button", { name: /保存项目规则|Save project rule/ }).click();
    await expect(inspector).toContainText(/已保存|Saved/);
    await expect.poll(() => page.evaluate(() => (window as any).__AGENT_GUI_DESKTOP_FIXTURE_READ__("ORBIT.md"))).toContain("RuntimeLedger-first");
  });

  test("settings context panel manages user rules injected by mode", async ({ page }) => {
    await installDesktopFixture(page);
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    await page.locator(".workbench-header-actions").getByRole("button", { name: "设置" }).click();
    await page.getByRole("button", { name: /上下文|Context/ }).click();
    await page.getByRole("button", { name: /添加规则|Add rule/ }).click();
    await page.getByLabel(/规则标题|Rule title/).fill("Planner preference");
    await page.locator(".context-rule-editor textarea").fill("Prefer asking before proposing risky architecture changes.");
    await page.getByRole("button", { name: /返回应用/ }).click();

    await page.getByRole("button", { name: "手动路径" }).click();
    await page.getByPlaceholder(/输入本地项目目录/).fill(fixtureWorkspace);
    await page.getByRole("button", { name: "应用" }).click();
    await importFixtureProvider(page);
    await page.locator(".composer textarea").fill("审查项目，制定改进项目的计划");
    await page.locator(".send-button").click();
    await expect(page.locator(".agent-collaboration-timeline")).toContainText(/计划草案|Plan Draft|Fixture planner draft/, { timeout: 5000 });

    await page.getByRole("tab", { name: /上下文|Context/ }).click();
    const inspector = page.getByTestId("current-context-inspector");
    await expect(inspector).toContainText("Planner preference");
    await expect(inspector).toContainText("Prefer asking before proposing risky architecture changes.");
    await expect(inspector).toContainText(/权限影响|Permission impact/);
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

  test("project can keep multiple named threads", async ({ page }) => {
    await installDesktopFixture(page);
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "手动路径" }).click();
    await page.getByPlaceholder(/输入本地项目目录/).fill(fixtureWorkspace);
    await page.getByRole("button", { name: "应用" }).click();

    await page.locator(".composer textarea").fill(samplePlan);
    await page.locator(".composer textarea").press("Enter");
    await expect(page.locator(".plan-card")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".project-thread-list button.active")).toContainText("Plan Only", { timeout: 5000 });

    await page.locator(".project-threads header button").click();
    await expect(page.locator(".project-thread-list button.active")).toContainText(/未命名对话|Untitled thread/);
    await expect(page.locator(".plan-card")).toHaveCount(0);

    await page.locator(".project-thread-list button", { hasText: "Plan Only" }).click();
    await expect(page.locator(".plan-card")).toBeVisible({ timeout: 5000 });
  });

  test("long thread history scrolls without pushing the file tree below the rail", async ({ page }) => {
    await installDesktopFixture(page);
    await page.setViewportSize({ width: 1440, height: 920 });
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "手动路径" }).click();
    await page.getByPlaceholder(/输入本地项目目录/).fill(fixtureWorkspace);
    await page.getByRole("button", { name: "应用" }).click();

    for (let i = 0; i < 14; i += 1) {
      await page.locator(".project-threads header button").click();
    }

    await expect(page.locator(".project-thread-list")).toBeVisible();
    await expect(page.locator(".rail-files")).toBeVisible();
    const threadListCanScroll = await page.locator(".project-thread-list").evaluate((element) => element.scrollHeight > element.clientHeight);
    expect(threadListCanScroll).toBe(true);

    const railFilesBox = await page.locator(".rail-files").boundingBox();
    const footerBox = await page.locator(".rail-footer").boundingBox();
    expect(railFilesBox).not.toBeNull();
    expect(footerBox).not.toBeNull();
    expect(railFilesBox?.height || 0).toBeGreaterThan(180);
    expect((railFilesBox?.y || 0) + (railFilesBox?.height || 0)).toBeLessThanOrEqual((footerBox?.y || 0) + 1);
  });

  test("new threads stay blank after session restore and thread rows can archive or delete", async ({ page }) => {
    await installDesktopFixture(page);
    await page.addInitScript(() => {
      localStorage.setItem("agent-gui.session", JSON.stringify({
        activeProjectId: "default",
        activeThreadId: "restored",
        importedPlan: null,
        providerSettings: { activeProviderId: "deepseek", configs: {} },
        agentEvents: [{
          id: "old-session-event",
          role: "planner",
          name: "Old Session",
          status: "done",
          message: "OLD SESSION EVENT SHOULD NOT ENTER NEW THREAD",
          timestamp: "12:00:00",
        }],
        lastActiveAt: "2026-05-27T00:00:00.000Z",
      }));
    });
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("OLD SESSION EVENT SHOULD NOT ENTER NEW THREAD")).toBeVisible();

    await page.getByRole("button", { name: "手动路径" }).click();
    await page.getByPlaceholder(/输入本地项目目录/).fill(fixtureWorkspace);
    await page.getByRole("button", { name: "应用" }).click();
    await page.locator(".project-threads header button").click();
    await expect(page.getByText("OLD SESSION EVENT SHOULD NOT ENTER NEW THREAD")).toHaveCount(0);

    await page.locator(".composer textarea").fill(samplePlan);
    await page.locator(".composer textarea").press("Enter");
    await expect(page.locator(".project-thread-list button.active")).toContainText("Plan Only", { timeout: 5000 });
    await page.locator(".project-threads header button").click();

    const planRow = page.locator(".project-thread-row", { hasText: "Plan Only" });
    await planRow.getByRole("button", { name: "线程操作" }).click();
    await page.getByRole("menuitem", { name: "归档线程" }).click();
    await expect(planRow).toHaveCount(0);

    await page.locator(".composer textarea").fill(samplePlan.replace("Plan Only", "Delete Me"));
    await page.locator(".composer textarea").press("Enter");
    await expect(page.locator(".project-thread-list button.active")).toContainText("Delete Me", { timeout: 5000 });
    await page.locator(".project-threads header button").click();

    const deleteRow = page.locator(".project-thread-row", { hasText: "Delete Me" });
    await deleteRow.getByRole("button", { name: "线程操作" }).click();
    await page.getByRole("menuitem", { name: "删除线程" }).click();
    await expect(deleteRow).toHaveCount(0);
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

  test("file action menu opens workspace files through controlled actions", async ({ page }) => {
    await installDesktopFixture(page);
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "手动路径" }).click();
    await page.getByPlaceholder(/输入本地项目目录/).fill(fixtureWorkspace);
    await page.getByRole("button", { name: "应用" }).click();

    const packageRow = page.locator(".file-tree-node.file", { hasText: "package.json" });
    await expect(packageRow).toBeVisible({ timeout: 10000 });
    await packageRow.click();
    await expect(page.locator(".monaco-readonly-preview")).toContainText("package.json", { timeout: 10000 });

    await packageRow.click({ button: "right" });
    await expect(page.getByRole("menu")).toContainText(/VS Code/);
    await page.getByRole("menuitem", { name: /在 VS Code 中打开|Open in VS Code/ }).first().click();
    await expect.poll(() => page.evaluate(() => (window as any).__AGENT_GUI_DESKTOP_FIXTURE_ACTIONS__ || [])).toContainEqual({
      path: "package.json",
      workspacePath: fixtureWorkspace,
      action: "vscode",
    });

    await page.locator(".file-action-path-label", { hasText: "package.json" }).click();
    await page.getByRole("menuitem", { name: /复制路径|Copy path/ }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__AGENT_GUI_DESKTOP_FIXTURE_CLIPBOARD__)).toBe(`${fixtureWorkspace}/package.json`);
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

    await page.getByRole("menuitem", { name: "隐藏详情检查器" }).click();
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
    await page.getByRole("button", { name: /开始执行/ }).click();
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
    await page.getByRole("button", { name: /开始执行/ }).click();

    await openChangesInspector(page);
    await expect(page.locator(".approval-dialog")).toContainText(/需要授权|Authorization required/, { timeout: 10000 });
    await expect(page.locator(".approval-dialog")).toContainText("npm test");
    await expect(page.locator("[data-testid='timeline-pending-actions']")).toContainText(/批准命令|Approve command/, { timeout: 10000 });
    await approveCurrentOverlay(page);
    await page.getByRole("button", { name: /继续执行|Continue/ }).click();

    await page.getByRole("tab", { name: /终端|Terminal/ }).click();
    await expect(page.locator(".dock-terminal")).toContainText("Desktop runtime required", { timeout: 10000 });

    const patchReview = await currentPatchReview(page);
    await expect(patchReview).toBeVisible({ timeout: 10000 });
    await expect(patchReview).toContainText(/沙盒 已预演|沙盒 预演失败|Sandbox Previewed|Sandbox Preview failed/);
    await expect(patchReview).toContainText("AGENT_GUI_FIXTURE.md");
    await expect(page.locator(".agent-collaboration-timeline")).toContainText(/Agent 提出|Agent proposed|Agent 提出了/);
    await expect(page.locator(".agent-collaboration-timeline")).not.toContainText('"tool"');

    await patchReview.locator(".apply-patch-action-btn").first().click();
    await expect.poll(() => page.evaluate(() => (window as any).__AGENT_GUI_DESKTOP_FIXTURE_LOG__ || [])).toContain("apply_workspace_patches_transactional");
    await expect(page.locator(".approval-dialog")).toContainText("npm test", { timeout: 10000 });
    await page.locator(".approval-dialog").getByRole("button", { name: /拒绝|Deny/ }).click();
    await openChangesInspector(page);
    await expect(page.locator(".dock-applied-history")).toContainText(/所有修改已安全应用到本地|All changes have been applied locally/, { timeout: 10000 });

    await page.getByRole("tab", { name: /文件|Files/ }).click();
    await page.getByPlaceholder("搜索文件").fill("AGENT_GUI_FIXTURE");
    await page.locator(".file-tree-node.file", { hasText: "AGENT_GUI_FIXTURE.md" }).click();
    await expect(page.locator("[data-testid='monaco-readonly-preview']")).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 10000 });
  });

  test("malformed patch prose is corrected into a strict propose_patch review item", async ({ page }) => {
    await installDesktopFixture(page);
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    await startFixtureBuild(page, malformedPatchPlan);
    await approveCurrentOverlay(page);
    await page.getByRole("button", { name: /继续执行|Continue/ }).click();
    const patchReview = await currentPatchReview(page);

    await expect(patchReview).toBeVisible({ timeout: 10000 });
    await expect(patchReview).toContainText("AGENT_GUI_FIXTURE.md");
    await expect(page.locator(".agent-collaboration-timeline")).not.toContainText("<补丁>");
    await expect(page.locator(".agent-collaboration-timeline")).not.toContainText('"patches"');
    await expect(patchReview).toContainText(/沙盒 已预演|Sandbox Previewed|预演失败|Preview failed/);
  });

  test("pending command approval survives reload and approve executes local resume action", async ({ page }) => {
    await installDesktopFixture(page);
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "手动路径" }).click();
    await page.getByPlaceholder(/输入本地项目目录/).fill(fixtureWorkspace);
    await page.getByRole("button", { name: "应用" }).click();
    await startFixtureBuild(page);

    const approval = page.locator(".approval-dialog");
    await expect(approval).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2300);
    await page.reload();
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });
    await page.getByRole("tab", { name: /变更|Changes/ }).click();

    const recoveredApproval = page.locator(".approval-dialog");
    await expect(recoveredApproval).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".agent-collaboration-timeline")).toContainText(/已恢复等待态|已恢复等待操作|Recovered Waiting State/, { timeout: 10000 });
    await recoveredApproval.getByRole("button", { name: /批准|Approve/ }).click();

    await expect.poll(() => page.evaluate(() => (window as any).__AGENT_GUI_DESKTOP_FIXTURE_LOG__ || [])).toContain("run_command_async");
    await page.getByRole("tab", { name: /终端|Terminal/ }).click();
    await expect(page.locator(".dock-terminal")).toContainText("npm test", { timeout: 5000 });
  });

  test("pending question survives reload and records recovered answer", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });
    await startFixtureBuild(page, questionPlan, { openChanges: false });

    const questionDialog = page.locator(".structured-question-dialog");
    await expect(questionDialog).toBeVisible({ timeout: 10000 });
    await expect(questionDialog).toContainText("Safe fixture path");
    await page.waitForTimeout(2300);
    await page.reload();
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });

    const recoveredQuestion = page.locator(".structured-question-dialog");
    await expect(recoveredQuestion).toBeVisible({ timeout: 10000 });
    await recoveredQuestion.getByText(/否，请告诉 Orbit 如何调整|No, tell Orbit/).click();
    await recoveredQuestion.locator("textarea").fill("Use the recovered fixture answer.");
    await recoveredQuestion.getByRole("button", { name: /继续|Continue/ }).click();
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

    await approveCurrentOverlay(page);
    await page.getByRole("button", { name: /继续执行|Continue/ }).click();
    let patchReview = await currentPatchReview(page);
    await expect(patchReview).toContainText("AGENT_GUI_FIXTURE.md", { timeout: 10000 });
    await page.waitForTimeout(2300);
    await page.reload();
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });
    patchReview = await currentPatchReview(page);

    await expect(patchReview).toContainText("AGENT_GUI_FIXTURE.md", { timeout: 10000 });
    await patchReview.locator(".apply-patch-action-btn").first().click();
    await expect.poll(() => page.evaluate(() => (window as any).__AGENT_GUI_DESKTOP_FIXTURE_LOG__ || [])).toContain("apply_workspace_patches_transactional");
    await expect(page.locator(".approval-dialog")).toContainText("npm test", { timeout: 10000 });
    await expect(page.getByRole("button", { name: /继续执行|Continue/ })).toBeVisible({ timeout: 10000 });
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
    await page.getByRole("button", { name: /开始执行/ }).click();
    await expect(page.locator(".agent-collaboration-timeline")).toContainText(/Ollama 当前仅接入|Ollama/, { timeout: 10000 });
    await expect(page.locator(".dock-diff-card")).toHaveCount(0);
  });

  test("fixture provider ask_user flow opens structured question overlay", async ({ page }) => {
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
    await page.getByRole("button", { name: /开始执行/ }).click();

    const questionDialog = page.locator(".structured-question-dialog");
    await expect(questionDialog).toBeVisible({ timeout: 10000 });
    await expect(questionDialog).toContainText(/Which implementation path|Safe fixture path/);
    await questionDialog.locator(".structured-question-info").first().hover();
    await expect(page.getByRole("tooltip")).toContainText(/Read the package manifest/);
    await page.keyboard.press("2");
    await expect(questionDialog.locator(".structured-question-option").nth(1)).toHaveClass(/selected/);
    await page.keyboard.press("1");
    await page.keyboard.press("Enter");
    await expect(page.locator(".agent-collaboration-timeline")).toContainText(/Safe fixture path|回答|answered/i, { timeout: 10000 });
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
    await page.getByRole("button", { name: /开始执行/ }).click();

    await page.getByRole("tab", { name: /变更|Changes/ }).click();
    await approveCurrentOverlay(page);
    await page.getByRole("button", { name: /继续执行|Continue/ }).click();
    const patchReview = await currentPatchReview(page);
    await expect(patchReview).toContainText("AGENT_GUI_FIXTURE.md", { timeout: 10000 });

    await page.evaluate(() => {
      (window as any).__AGENT_GUI_DESKTOP_FIXTURE_MUTATE__("AGENT_GUI_FIXTURE.md", "# Local Change\n\nUser edited this before approving.\n");
    });

    await patchReview.locator(".apply-patch-action-btn").first().click();
    await expect(patchReview).toContainText(/3-Way Merge|3-way merge|冲突/, { timeout: 10000 });
    await expect.poll(() => page.evaluate(() => {
      const log = (window as any).__AGENT_GUI_DESKTOP_FIXTURE_LOG__ || [];
      return log.filter((entry: string) => entry === "apply_workspace_patches_transactional").length;
    })).toBe(0);

    const patchDialog = page.getByRole("dialog", { name: /补丁提案|Patch Proposal/ });
    await patchDialog.getByRole("button", { name: /解决冲突|Resolve/ }).click();
    await patchDialog.locator(".apply-patch-action-btn").first().click();
    await expect.poll(() => page.evaluate(() => {
      const log = (window as any).__AGENT_GUI_DESKTOP_FIXTURE_LOG__ || [];
      return log.filter((entry: string) => entry === "apply_workspace_patches_transactional").length;
    })).toBe(1);
    await expect(page.locator(".approval-dialog")).toContainText("npm test", { timeout: 10000 });
    await page.locator(".approval-dialog").getByRole("button", { name: /拒绝|Deny/ }).click();
    await openChangesInspector(page);
    await expect(page.locator(".dock-applied-history")).toContainText(/所有修改已安全应用到本地|All changes have been applied locally/, { timeout: 10000 });
  });

  test("multi-file patch rollback restores edited files and removes created files", async ({ page }) => {
    await installDesktopFixture(page);
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });
    await page.evaluate(() => {
      (window as any).__AGENT_GUI_DESKTOP_FIXTURE_MUTATE__("AGENT_GUI_FIXTURE.md", "# AGENT_GUI_FIXTURE.md\nfixture preview");
    });

    await startFixtureBuild(page, multiFileRollbackPlan);
    await approveCurrentOverlay(page);
    await page.getByRole("button", { name: /继续执行|Continue/ }).click();
    const patchReview = await currentPatchReview(page);
    await expect(patchReview).toContainText("AGENT_GUI_FIXTURE.md", { timeout: 10000 });
    await expect(patchReview).toContainText("AGENT_GUI_CREATED.md", { timeout: 10000 });

    await patchReview.locator(".apply-patch-action-btn").first().click();
    await expect.poll(() => page.evaluate(() => (window as any).__AGENT_GUI_DESKTOP_FIXTURE_READ__("AGENT_GUI_CREATED.md"))).toContain("Created File");
    await page.locator(".approval-dialog").getByRole("button", { name: /拒绝|Deny/ }).click();
    await openChangesInspector(page);

    await page.locator(".dock-applied-history").getByRole("button", { name: /回滚|Rollback/ }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__AGENT_GUI_DESKTOP_FIXTURE_LOG__ || [])).toContain("restore_workspace_file_snapshot");
    await expect.poll(() => page.evaluate(() => (window as any).__AGENT_GUI_DESKTOP_FIXTURE_READ__("AGENT_GUI_FIXTURE.md"))).toContain("fixture preview");
    await expect.poll(() => page.evaluate(() => (window as any).__AGENT_GUI_DESKTOP_FIXTURE_READ__("AGENT_GUI_CREATED.md"))).toBeUndefined();
    await expect(page.locator(".dock-applied-history")).toContainText(/已回滚文件|Rollback|回滚/, { timeout: 10000 });
  });

  test("sandbox preview failure can be retried before patch apply", async ({ page }) => {
    await installDesktopFixture(page);
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });
    await page.evaluate(() => {
      (window as any).__AGENT_GUI_DESKTOP_FIXTURE_SANDBOX_FAIL_ONCE__ = true;
    });

    await startFixtureBuild(page);
    await approveCurrentOverlay(page);
    await page.getByRole("button", { name: /继续执行|Continue/ }).click();
    const patchReview = await currentPatchReview(page);
    await expect(patchReview).toContainText(/沙盒预演失败|sandbox preview failed|failed/i, { timeout: 10000 });

    await patchReview.locator(".apply-patch-action-btn").first().click();
    await expect(patchReview).toContainText(/重试通过|retry|预演/, { timeout: 10000 });
    await patchReview.locator(".apply-patch-action-btn").first().click();

    await expect.poll(() => page.evaluate(() => {
      const log = (window as any).__AGENT_GUI_DESKTOP_FIXTURE_LOG__ || [];
      return log.filter((entry: string) => entry === "apply_workspace_patches_transactional").length;
    })).toBe(1);
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
    await page.getByRole("button", { name: /开始执行/ }).click();

    await page.getByRole("tab", { name: /变更|Changes/ }).click();
    const approval = page.locator(".approval-dialog");
    await expect(approval).toBeVisible({ timeout: 10000 });
    await approval.getByRole("button", { name: /拒绝|Deny/ }).click();

    await expect(page.locator(".agent-collaboration-timeline")).toContainText(/拒绝|denied/i, { timeout: 10000 });
    await page.getByRole("tab", { name: /终端|Terminal/ }).click();
    await expect(page.locator(".dock-terminal")).toHaveCount(0);
  });

  test("fixture provider install approval denial does not create terminal output", async ({ page }) => {
    await installDesktopFixture(page);
    await page.goto("/");
    await expect(page.locator(".workbench-shell")).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "手动路径" }).click();
    await page.getByPlaceholder(/输入本地项目目录/).fill(fixtureWorkspace);
    await page.getByRole("button", { name: "应用" }).click();

    await startFixtureBuild(page, installApprovalPlan, { openChanges: false });

    const approval = page.locator(".approval-dialog");
    await expect(approval).toBeVisible({ timeout: 10000 });
    await expect(approval).toContainText("npm install");
    await expect(approval).toContainText(/安装|Install/);
    await approval.getByRole("button", { name: /拒绝|Deny/ }).click();

    await expect(page.locator(".agent-collaboration-timeline")).toContainText(/拒绝|denied/i, { timeout: 10000 });
    await page.getByRole("tab", { name: /终端|Terminal/ }).click();
    await expect(page.locator(".dock-terminal")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as any).__AGENT_GUI_DESKTOP_FIXTURE_LOG__ || [])).not.toContain("run_command_async");
  });
});
