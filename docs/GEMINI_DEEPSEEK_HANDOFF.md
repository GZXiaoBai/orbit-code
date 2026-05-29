# Gemini / DeepSeek Handoff

Last updated: 2026-05-29.

This document is written for the next model taking over the project. Treat `docs/STATUS_MATRIX.md` as the source of truth and this file as the practical handoff narrative.

## Read First

1. `AGENTS.md`
2. `docs/STATUS_MATRIX.md`
3. `docs/NEXT_TASKS.md`
4. `docs/KNOWN_FAILURES.md`
5. Then inspect the code.

Do not trust old claims that all planned features are complete. The project has real implementation depth, but several product flows and Interfaces are still unstable.

## Current Project Shape

Orbit Code is a Tauri v2 + React 19 + TypeScript + Rust desktop coding Agent workbench.

Strong areas:

- Rust command gateway has substantial implementation: files, shell, patching, LLM relay, merge, SQLite, embeddings.
- Unit/build/Rust test baseline has been healthy in the latest audit.
- Plan parser, task queue, settings, timeline, Diff viewer, and Agent Loop prototypes exist.

Weak areas:

- Frontend architecture is still broad around `useWorkspace.ts`, though Review Dock, Agent run, patch, approval, file-system, layout, and project Modules now exist.
- Runtime/generated Agent messages still need a proper i18n-aware message layer.
- Real provider smoke for OpenAI/Anthropic/Gemini/DeepSeek remains manual because CI uses the offline Fixture provider.
- Real DeepSeek mini-lab smoke has a current verified manual path from 2026-05-29: Plan generated a 2-task draft, user accepted Build, DeepSeek proposed `SMOKE_LEDGER_20260529.md`, sandbox preview passed, the patch applied transactionally, command approval ran `npm run test:run`, verification passed, and final summary appeared. A previous taskBoard edit attempt correctly failed at stale-write sandbox preview and should be used as the next conflict-recovery regression.
- Rust still has compatibility paths that fall back to `current_dir()`; new command paths should stay explicit about workspace root.

## Latest Verified State

The latest stabilization pass focused on single-task Agent reliability and runtime protocol closure:

- Agent waiting state now persists Agent run session, pending approvals, pending questions, patch proposals, terminal runs, and typed `ThreadEvent` records. Legacy `AgentEvent` is now a compatibility projection.
- Reload recovery is covered for pending command approval, blocking question, and patch review. Recovery restores the pending UI and performs explicit local resume actions; it does not automatically continue model generation.
- Center thread now owns pending action affordances, while central overlays handle command/verification approvals and structured questions.
- Review Dock is now an Inspector for file preview, patch diff/history, terminal records, and recent run details. It no longer duplicates the main approval/question action queue.
- Desktop workspace reload now restores the current workspace root and file tree through the desktop gateway.
- Ollama remains discovery-only and is blocked from Build execution.
- `RuntimeLedger` now carries typed thread events, `ActionRequired`, tool-call lifecycle records, terminal runs, and checkpoint projections. Pending actions and run steps are now derived from a ledger snapshot.
- `ToolCallLifecycle` tracks generated, policy-evaluated, action-required, running, completed, failed, denied, and cancelled states.
- `SmokeRunController` blocks fixture providers from passing DeepSeek smoke and records typed milestone failures.
- Manual DeepSeek smoke evidence exists in the desktop thread named `在 orbit-mini-lab 新增 SMOKE_LEDGER_20260529.md 并执行 smoke 验收`.
- Context Inspector shows Orbit rules, skills, disabled blocks, and external rule import candidates; external files such as `AGENTS.md` and `CLAUDE.md` are not auto-injected.

Latest verification:

```bash
npm test -- --run                            # 217 passed
npm run build                                # passed
cargo test --manifest-path src-tauri/Cargo.toml # 48 passed
npm run test:e2e                             # 42 passed
npm run tauri build -- --debug               # passed
```

Latest frontend stabilization pass:

- Main visible UI copy now routes through `src/i18n/copy.ts` across shell/project rail/thread/review dock/settings/terminal/diff surfaces.
- The old OutputPanel/SettingsModal path has been replaced by Review Dock and independent Settings workspace surfaces.
- Added `src/styles/responsive.css`; 390x844 Browser smoke hides auxiliary panels and keeps conversation/composer usable without horizontal overflow.
- Extracted `useEmbeddingIndex` and `useWindowActions` so `useWorkspace.ts` is smaller, though it remains the main architecture hotspot.

## What Not To Do

- Do not add more workflow logic to `Conversation.tsx`.
- Do not add more top-level returns to `useWorkspace.ts` unless you are actively shrinking the Interface.
- Do not claim Ollama desktop LLM support until Rust gateway support is implemented or documented as local-only.
- Do not mark DeepSeek smoke verified from fixture/provider-simulated runs.
- Do not auto-inject external agent rule files; surface them as import candidates only.
- Do not bypass `apply_workspace_patches_transactional` for Agent-generated file changes.
- Do not mark packaging complete without running a desktop debug build on the target platform.

## Recommended Next Implementation Order

### 1. Expand Real DeepSeek Smoke Coverage

The current happy path has passed once against `/Users/zhoujunjie/PersonalProjects/test for orbit/orbit-mini-lab`. Next, keep the same workspace and add targeted smoke cases for stale-write conflict recovery, restored verification approval, project rules/skills context visibility, and app restart resume behavior. If a case fails, record it as a failure ledger item and fix runtime before adding features.

### 2. Split Frontend Views

Already created under `src/components/thread/`:

- `PlanSummary`
- `AgentTimeline`
- `CommandApprovalCard`
- `EmptyThreadState`

Still worth extracting if the streaming surface grows:

- `StreamingMessage`

The goal is not cosmetic splitting. The goal is a deeper Interface for the conversation surface: each Module should own one concept and expose a small prop set.

### 3. Split State

Extract from `useWorkspace.ts`:

- `useAgentRun` (extracted and now writes typed `ThreadEvent` directly; Build-turn preparation is starting to move into `AgentRunKernel`)
- `usePatchWorkflow` (extracted and now updates typed `ThreadEvent` directly)
- `useEmbeddingIndex` (done)
- `useWindowActions` (done)

Leave `useWorkspace` as a composition layer returning a narrow view model.

### 4. Harden Runtime

Fix these seams:

- Keep `run_command` structured as `{ command, args, reason }`.
- Keep command/write/install/network actions behind central overlay approval.
- Keep Agent patch proposals out of direct writes; apply only through sandbox preview, conflict handling, and `apply_workspace_patches_transactional`.
- Continue removing implicit workspace fallback from Rust commands.
- Finish removing legacy approval/question adapters from Review Dock projections; it should consume ledger selectors only.

### 5. Redesign Frontend Identity

The user explicitly rejected a Codex clone. Keep the efficient three-zone workbench, but remove obvious mimicry and reduce visual clutter. Black and white themes must both be first-class.

## Architectural Language For Refactors

Use this vocabulary when discussing architecture:

- Module
- Interface
- Implementation
- Depth
- Seam
- Adapter
- Leverage
- Locality

The top architectural problem is shallow Modules: large Interfaces with little Leverage. Refactors should make callers know less, not just move files.
