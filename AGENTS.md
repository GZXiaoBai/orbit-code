# AGENTS.md - Orbit Code AI Assistant Handover Guide

本文档是接手 Orbit Code 的快速入口。请以它和 `docs/STATUS_MATRIX.md` 为准；旧交接文档中带有“全部完成”“终极版”的表述已经被降级为历史记录，不能作为事实来源。

## 项目概况

Orbit Code 是一个 Tauri v2 + React 19 + TypeScript + Rust 的本地优先编码 Agent 工作台。目标是多模型、多平台、可导入 Coding Plan、可审查本地执行的桌面应用。

当前状态：后端能力推进较多，前端可运行但架构和交互合约需要收敛。不要把它当成已完成产品。

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
    review/ReviewDock.tsx         # 文件预览、任务、审批、Patch、Terminal
    settings/SettingsWorkspace.tsx# 独立设置页
  state/
    useWorkspace.ts               # 当前最大状态协调 Module，仍需拆分
    useSession.ts                 # Plan/provider/session 子状态
    useFileSystem.ts              # 文件树/命令日志子状态
    agentLoopEngine.ts            # ReAct 风格 Agent Loop
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
  commands.rs                     # 文件、命令、Patch、LLM、Embedding、Merge
  db.rs                           # SQLite schema 和 CRUD
  ast_parser.rs                   # tree-sitter AST parser
  code_graph.rs                   # 符号/依赖图
  embedding.rs                    # OpenAI embedding + SQLite vector store
  process_monitor.rs              # 子进程超时/内存守卫
  window_manager.rs               # 多窗口命令
```

## 已验证基线

最近审查日期：2026-05-24。

```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run test:e2e
```

当前目标是让以上四项长期全部通过。任何接手 Agent 修改前后都要至少跑受影响层的测试。

## 当前已知事实

- React/Vite shell 可以运行。
- 亮/暗主题已存在，但视觉仍需重新设计，避免继续像 Codex。
- Plan v1 YAML 解析器和 Vitest 测试存在。
- Rust SQLite、Keychain、LLM relay、事务 Patch、三方合并、AST/code graph、embedding 模块均有实现和部分测试。
- `useWorkspace.ts` 仍是最大技术债，当前 Interface 过宽，Locality 差。
- 旧 `Conversation.tsx` / `Sidebar.tsx` / `CommandApprovalCard` 主路径已经删除；后续不要恢复两套审查体验。
- Agent Loop 已有原型，但工具执行、审批和事务 Patch Seam 还需要加固。
- Provider registry 声明了 Ollama，但 Rust LLM 网关目前没有 Ollama host 放行。

## 架构约束

1. 本地文件、Shell、Patch 操作必须走 Rust 命令网关。
2. API Key 只能进入 Orbit 本地加密凭据库；SQLite/localStorage 不能保存明文密钥。
3. 文件读写必须保留 workspace 路径校验。
4. 多文件写入必须保留事务 rollback。
5. 命令审批策略必须真实生效；危险命令不能被前端自动放行。
6. 文档必须区分 `verified`、`partial`、`design-only`、`broken`、`not-started`。

## 下一步优先级

1. 修复并保持 E2E 核心流程：Plan 导入、任务队列、timeline、开始执行按钮。
2. 建立 `docs/STATUS_MATRIX.md` 作为唯一状态来源。
3. 拆分 `useWorkspace.ts`，把 Agent run、Patch、runtime gateway、session 拆成更深 Module。
4. 重做前端视觉系统：保留三栏效率，但建立独立 Agent Workbench 风格，黑/白主题都要完整。
5. 加固 Runtime Seam：显式 workspace root、真实审批等待、事务 Patch 统一入口、命令参数结构化。

## 给 Gemini / DeepSeek / GPT 的提示

- 先读 `docs/STATUS_MATRIX.md`，不要先相信历史交接文档。
- 如果看到“所有功能已完成”的说法，请当成过期内容。
- 修改前端时优先缩小 Interface，而不是继续往 `ThreadCanvas.tsx`、`ReviewDock.tsx` 和 `useWorkspace.ts` 里塞 props。
- 修改 Rust command 后必须跑 `cargo test --manifest-path src-tauri/Cargo.toml`。
- 修改 Plan/Composer/Timeline 后必须跑 `npm run test:e2e`。
