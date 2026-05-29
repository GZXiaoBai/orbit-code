# AGENTS.md - Orbit Code AI Assistant Handover Guide

本文档是接手 Orbit Code 的快速入口。请以它和 `docs/STATUS_MATRIX.md` 为准；旧交接文档中带有“全部完成”“终极版”的表述已经被降级为历史记录，不能作为事实来源。

## 项目概况

Orbit Code 是一个 Tauri v2 + React 19 + TypeScript + Rust 的本地优先编码 Agent 工作台。目标是多模型、多平台、可导入 Coding Plan、可审查本地执行的桌面应用。

当前状态：可靠闭环已经有第一版基础，`RuntimeLedger / ActionRequired / ToolCallLifecycle / Context Inspector` 是当前主线；前端和 Rust gateway 仍需继续拆深。不要把它当成已完成产品。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面壳 | Tauri 2 |
| 前端 | React 19, TypeScript 5.8, Vite 7 |
| 样式 | 纯 CSS，拆分在 `src/styles/*.css` |
| 状态 | React hooks，目前核心聚合在 `src/state/useWorkspace.ts` |
| 存储 | Rust SQLite 命令 + Web/localStorage 降级 |
| 凭据 | Orbit 本地加密凭据库：Argon2id + AES-GCM，密文进 SQLite，解锁后密钥只驻留进程内存 |
| LLM 网关 | Rust `reqwest` 中继，前端 `src/services/llmService.ts` |
| 测试 | Vitest, Playwright, Cargo test |

## 关键文件

### 前端

```text
src/
  App.tsx                         # 根布局和大 props 转接
  main.tsx                        # 引入 styles/*
  components/
    Composer.tsx                  # Plan/需求输入、附件和运行控制
    DiffViewer.tsx                # 行级 Diff 与冲突展示
    RunControlBar.tsx             # Plan/Build、模型和推理强度入口
  features/
    workbench/WorkbenchShell.tsx  # 三域工作台骨架
    workbench/ProjectRail.tsx     # 项目、文件树、对话列表、项目菜单
    thread/ThreadCanvas.tsx       # 中央线程、Plan、timeline、Composer
    review/ReviewDock.tsx         # Inspector：文件、Diff、Terminal、Context、History
    settings/SettingsWorkspace.tsx# 独立设置页
  state/
    useWorkspace.ts               # 当前最大状态协调 Module，仍需拆分
    useSession.ts                 # Plan/provider/session 子状态
    useFileSystem.ts              # 文件树/命令日志子状态
    agentLoopEngine.ts            # ReAct 风格 Agent Loop，正在被 runner/executor/controller 拆分
    agentRunKernel.ts             # Build turn 准备、guard、task/resume/final-summary 选择
    agentTurnRunner.ts            # Plan/Build turn lifecycle seam
    toolCallExecutor.ts           # ToolCallLifecycle / permission scheduling seam
    sessionRestoreController.ts   # 恢复 pending action / terminal explicit-continue
    checkpointRestoreController.ts# checkpoint runtime snapshot restore
  runtime/
    toolRegistry.ts               # Agent 工具定义和执行 Adapter
    approvalPolicy.ts             # 命令风险分类
    semanticSearch.ts             # 向量搜索优先、LLM 排序回退
  storage/
    sessionStore.ts
    tauriStorage.ts
    workspaceStorage.ts
    keychain.ts
```

### 后端

```text
src-tauri/src/
  lib.rs                          # Tauri command 注册
  commands/
    mod.rs                        # Tauri commands 主模块，保持现有命令名
    file.rs                       # 文件相关命令 extraction target
    command.rs                    # Shell/进程命令 extraction target
    patch.rs                      # Patch/checkpoint/rollback extraction target
    context.rs                    # Orbit context 文件命令 extraction target
    provider.rs                   # LLM/provider 命令 extraction target
    vault.rs                      # credential vault 命令 extraction target
  db.rs                           # SQLite schema 和 CRUD
  ast_parser.rs                   # tree-sitter AST parser
  code_graph.rs                   # 符号/依赖图
  embedding.rs                    # OpenAI embedding + SQLite vector store
  process_monitor.rs              # 子进程超时/内存守卫
  window_manager.rs               # 多窗口命令
```

## 已验证基线

最近审查日期：2026-05-29。

```bash
npm test -- --run
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run test:e2e
npm run tauri build -- --debug
```

当前目标是让以上四项长期全部通过。任何接手 Agent 修改前后都要至少跑受影响层的测试。

## 当前已知事实

- React/Vite shell 可以运行，macOS debug 包已验证。
- 亮/暗主题已存在；当前视觉方向是独立 Agent Workbench，而不是复制 Codex 资产。
- Plan/Build 第一版 runtime contract 已存在：Plan 只读，Build 才执行 command/patch/verification。
- Rust SQLite、Keychain、LLM relay、事务 Patch、三方合并、AST/code graph、embedding 模块均有实现和部分测试。
- `useWorkspace.ts` 仍是最大技术债，但 RuntimeLedger、ActionRequiredController、AgentRunKernel、ToolCallExecutor、SessionRestoreController 等深 Module 已开始分担职责。
- 旧 `Conversation.tsx` / `Sidebar.tsx` / `CommandApprovalCard` 主路径已经删除；后续不要恢复两套审查体验。
- Agent Loop 已通过真实 DeepSeek mini-lab happy path smoke；stale-write recovery、restored verification、rules/skills context path 仍需继续做真实 smoke。
- Provider registry 声明了 Ollama，但 Rust LLM 网关目前没有 Ollama host 放行。

## 架构约束

1. 本地文件、Shell、Patch 操作必须走 Rust 命令网关。
2. API Key 只能进入 Orbit 本地加密凭据库；SQLite/localStorage 不能保存明文密钥。
3. 文件读写必须保留 workspace 路径校验。
4. 多文件写入必须保留事务 rollback。
5. 命令审批策略必须真实生效；危险命令不能被前端自动放行。
6. 文档必须区分 `verified`、`partial`、`design-only`、`broken`、`not-started`。

## 下一步优先级

1. 保持完整验证基线：Vitest、build、E2E、Cargo、Tauri debug 包。
2. 继续把 Runner 从 React hook 中拆深：`AgentTurnRunner`、`ToolCallExecutor`、`SessionRestoreController`、`CheckpointRestoreController`。
3. 完成 stale-write recovery、restored verification、rules/skills context 的真实 DeepSeek smoke。
4. 继续拆分 `src-tauri/src/commands/mod.rs`，把 file/command/patch/context/provider/vault 的实现迁入子 Module。
5. 重做前端视觉系统：保留三栏效率，但建立独立 Agent Workbench 风格，黑/白主题都要完整。

## 给 Gemini / DeepSeek / GPT 的提示

- 先读 `docs/STATUS_MATRIX.md`，不要先相信历史交接文档。
- 如果看到“所有功能已完成”的说法，请当成过期内容。
- 修改前端时优先缩小 Interface，而不是继续往 `ThreadCanvas.tsx`、`ReviewDock.tsx` 和 `useWorkspace.ts` 里塞 props。
- 修改 Rust command 后必须跑 `cargo test --manifest-path src-tauri/Cargo.toml`。
- 修改 Plan/Composer/Timeline 后必须跑 `npm run test:e2e`。
