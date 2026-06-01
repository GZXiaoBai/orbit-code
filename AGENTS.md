# AGENTS.md - Orbit Code Handover Guide

本文档是接手 Orbit Code 的快速入口。请以它和 `docs/STATUS_MATRIX.md` 为准；历史交接文档只作为背景，不能作为当前事实源。

## 项目概况

Orbit Code 是一个 Tauri v2 + React 19 + TypeScript + Rust 的本地优先编码 Agent 工作台。当前路线已经切到 Codex sidecar：Orbit 负责桌面 UI、项目管理、多模型凭据、provider bridge 和审查展示；Agent runtime 由 `codex app-server` 提供。

核心事实源是 `Thread -> Turn -> Item`。前端不再解析模型工具 JSON，不再维护自研 runner/tool loop，也不迁移旧 runtime snapshot。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面壳 | Tauri 2 |
| 前端 | React 19, TypeScript 5.8, Vite 7 |
| 样式 | 纯 CSS，拆分在 `src/styles/*.css` |
| 状态 | React hooks；新 runtime 入口是 `useCodexSession` |
| 存储 | Rust SQLite 命令 + Web/localStorage 降级 |
| 凭据 | Orbit 本地加密凭据库：Argon2id + AES-GCM，密文进 SQLite，解锁后密钥只驻留进程内存 |
| Agent runtime | Codex sidecar via `codex app-server --listen stdio://` |
| Provider bridge | Orbit loopback Responses bridge，目标 `/v1/responses` 与 `/v1/models` |
| 测试 | Vitest, Playwright, Cargo test |

## 关键文件

```text
src/
  App.tsx
  main.tsx
  components/
    Composer.tsx
    DiffViewer.tsx
    RunControlBar.tsx
  domain/
    codex.ts
    runtimePrimitives.ts
    runtimeMessages.ts
    threadEvents.ts
    threadEventSelectors.ts
  runtime/
    codexAgentPort.ts
    codexItemProjection.ts
    contextProviders.ts
    workspaceGateway.ts
  state/
    useWorkspace.ts
    useCodexSession.ts
    useSession.ts
    useFileSystem.ts
  features/
    workbench/WorkbenchShell.tsx
    projects/ProjectRail.tsx
    thread/ThreadCanvas.tsx
    review/ReviewDock.tsx
    actions/ActionRequiredOverlay.tsx
    settings/SettingsWorkspace.tsx
  storage/
    sessionStore.ts
    tauriStorage.ts
    workspaceStorage.ts
    keychain.ts
```

```text
src-tauri/src/
  lib.rs
  commands/
    mod.rs
    codex.rs                       # Codex command façade; includes split runtime shards
    codex/
      00_types.rs
      10_state_sidecar.rs
      20_json_rpc.rs
      30_responses_bridge.rs
      40_direct_plan.rs
      50_app_server_lifecycle.rs
      60_notification_mapper.rs
      70_turn_commands.rs
      80_response_translation.rs
      90_tests.rs
    file.rs
    command.rs
    patch.rs
    context.rs
    provider.rs
    vault.rs
  db.rs
  ast_parser.rs
  code_graph.rs
  embedding.rs
  process_monitor.rs
  window_manager.rs
```

## 架构约束

1. 本地文件、Shell、Patch 操作必须走 Rust 命令网关或 Codex sidecar 审批链路。
2. API Key 只能进入 Orbit 本地加密凭据库；SQLite/localStorage 不能保存明文密钥。
3. Orbit bridge 只能监听 `127.0.0.1:<ephemeral>`。
4. 生成给 Codex 的临时配置不得包含 secret。
5. 新版本使用 `codex-sidecar.v1` session schema；旧会话只允许 legacy unsupported 展示和删除。
6. Provider registry 只负责 metadata、model discovery、vault key mapping，不直接驱动 Agent loop。
7. 文档必须区分 `verified`、`partial`、`design-only`、`broken`、`not-started`。

## 当前优先级

1. 验证真实 Codex app-server 长 turn：当前 runtime 已使用 persistent reader、pending response routing 和 `Orbit threadId -> Codex threadId` 进程内缓存；下一步重点是用真实 DeepSeek Build 压 approval/question/tool result/interrupt、crash cleanup。
2. DeepSeek 是唯一 Build provider。其他 OpenRouter、Qwen/DashScope、SiliconFlow、Kimi、Groq、自定义 OpenAI-compatible 先保留 discovery-only 和 blocked reason。
3. Plan/普通聊天走 `direct-deepseek-plan`，默认不启动 Codex app-server；Build 才走 `codex-app-server-build`。running turn 期间必须阻止重复提交，失败/中断/完成后恢复输入。
4. `npm run smoke:deepseek` 当前是 prepared sidecar + app-server routing contract smoke；`npm run smoke:deepseek:live-app-server` 已验证独立 live driver 的 approval -> terminal/fileEdit -> final summary。translation-only smoke 是 `npm run smoke:deepseek:bridge-unit`，旧直连 harness 是 `npm run smoke:deepseek:legacy`。下一步是把同等证据落到 Rust bridge + 桌面 UI Build 路径。
5. `npm run smoke:desktop-build` 是 packaged workbench Build smoke。默认只做 readiness；设置 `ORBIT_DESKTOP_BUILD_LIVE=1` 才执行真实 approval -> terminal/fileEdit -> usage/final summary；设置 `ORBIT_DESKTOP_BUILD_DENY=1` 验证拒绝路径。CI 的手动 `desktop-build-live` job 使用 `orbit-live-smoke` environment secret `ORBIT_LIVE_VAULT_BUNDLE_B64`，解包到临时 `ORBIT_APP_DATA_DIR`，设置隔离的 `ORBIT_DESKTOP_BUILD_WORKSPACE`，再在 Ubuntu `xvfb` 下跑 approve/deny 两条 live 路径。
6. 设置页要作为 Codex runtime control plane：sidecar version/path/sha256、bridge base URL、pid、last error、restart、model discovery、bridge smoke、Build enabled。
7. Smoke 证据默认只保留 `docs/smoke/latest-*.json`；只有设置 `ORBIT_SMOKE_KEEP_HISTORY=1` 才写 timestamp 历史，且历史 JSON 必须保持 Git ignored。
8. 跑并维护基线：`npm test -- --run`、`npm run build`、`cargo test --manifest-path src-tauri/Cargo.toml`、`npm run test:e2e`、`npm run smoke:deepseek`、`npm run tauri build -- --debug`。

## 接手提示

- 先读 `docs/STATUS_MATRIX.md`。
- 不要恢复已删除的自研 runtime、前端 tool loop、实验适配器或旧 session replay。
- 修改 Rust command 后跑 `cargo test --manifest-path src-tauri/Cargo.toml`。
- 修改 Thread/Composer/Timeline 后跑 `npm run test:e2e`，如果旧 E2E 仍未迁移，要明确记录。
