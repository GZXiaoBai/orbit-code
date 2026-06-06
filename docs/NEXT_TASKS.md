# Next Tasks

当前推进目标已进入 Beta 收尾。Beta 范围固定为 Codex sidecar + DeepSeek Build；其他 provider 继续 discovery-only，替代 Agent 只允许隔离 spike。

## Completed - Day 0 Baseline

1. 已整理稳定提交：Plan follow-up 线程上下文、accepted Plan Build 注入、accepted Plan 持久化、Build final summary 解锁、idle recover、usage projection、localStorage/diagnostics debounce。
2. 已保持基线全绿：`npm test -- --run`、`npm run build`、`npm run test:e2e`、`cargo test --manifest-path src-tauri/Cargo.toml`、`npm run smoke:plan`、`npm run smoke:deepseek`。
3. Smoke evidence 已收口为 `docs/smoke/latest-*.json`；需要历史时使用 `ORBIT_SMOKE_KEEP_HISTORY=1`，历史 JSON 必须保持 Git ignored。

## Completed - Week 1 Build Runtime

1. GitHub `desktop-build-live` workflow 已通过 approve 和 deny 两条 packaged desktop Build live smoke，并产生 verified artifact。
2. 已修 Build runtime 证据链：operation terminal state、appTurnId/threadId scope、usage evidence、multi-approval、sidecar cleanup。
3. 已覆盖 deterministic restart/recover 语义：active Build pending request、interrupt、stale event、sidecar cleanup 后 composer 不永久锁定。
4. Build idle auto-recover 已成为正式语义：60s 无 runtime progress 且无 pending approval/question 时恢复 composer，不写误导性 Codex error，保留 diagnostics/stage history。
5. Runtime state-machine 单测已覆盖：late running/status/cancel 不降级 terminal operation；turn completed/final summary 立即解锁；pending action 不触发 idle recover。

## Completed - Week 1 Plan/Build Product Loop

1. accepted Plan 是 thread 级状态并持久化在 `codex-sidecar.v1` session 中；旧 session 不迁移，只允许 unsupported 展示和删除。
2. 只有点击 “采纳并进入 Build” 的 Plan draft 才注入 Build prompt；用户直接导入 YAML 计划仍可用于“开始执行”任务选择，但不标记为 accepted Plan。
3. Build prompt 固定包含 accepted Plan title/goals/constraints/tasks/filesHint/verification/acceptance，再附用户本次 Build 指令。
4. Thread header 或 composer 附近显示 “Build 将使用已采纳计划”，切换 thread 后必须准确。
5. Plan follow-up prompt 保留同线程最近上下文，解决 “开始吧/继续/按这个来” 丢前文；timeline 仍显示用户原始输入。

## Completed - Week 2 Desktop Beta UX

1. Settings runtime control plane 已补 Beta gate：sidecar version/path/sha256、pid、bridge base URL、last error、restart/recover、latest smoke status、Build gate reason、runtime conformance 和 desktop live smoke 均可见。
2. Action/Review Dock 空态和恢复态已打磨：approval deny、question answer、patch conflict、usage strip、terminal output、file preview 都有明确可读文案。
3. First-run/blocked-state 文案已覆盖：未解锁 vault、未导入 DeepSeek、sidecar missing、Build provider blocked、macOS WebDriver blocked。
4. `docs/RELEASE_CHECKLIST.md` 已更新为 Beta 门禁；本地 dev、debug no-bundle、三平台 release build、Plan smoke、Build smoke、manual smoke 均有检查项。
5. README、AGENTS、STATUS_MATRIX 已明确 Beta 支持范围是 DeepSeek Build + Codex sidecar，其他 Agent/provider 是后续 spike。

## P2 - After Beta

1. 逐个验证 OpenAI/OpenRouter/Qwen/SiliconFlow/Kimi/Groq/Zhipu/Together/Fireworks/Cerebras/NVIDIA/Azure/custom Build bridge，再解除 blocked reason。
2. 将 Codex app-server `generate-ts` / JSON schema 导出固化为 repo fixture，降低 protocol drift 风险。
3. 做 OpenCode 或 Claude Code 的隔离 adapter spike；在通过 `AgentRuntimePort` conformance 前不得进入生产 Build UI。
