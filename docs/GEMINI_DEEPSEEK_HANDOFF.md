# Gemini / DeepSeek Handoff

Last updated: 2026-05-25.

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
- Rust still has compatibility paths that fall back to `current_dir()`; new command paths should stay explicit about workspace root.

## Latest Verified State

The latest stabilization pass focused on single-task Agent reliability:

- Agent waiting state now persists Agent run session, pending approvals, pending questions, patch proposals, terminal runs, and Agent events.
- Reload recovery is covered for pending command approval, blocking question, and patch review. Recovery restores the pending UI and performs explicit local resume actions; it does not automatically continue model generation.
- Review Dock now consumes `ReviewDockQueueModel` and delegates rendering to queue components:
  - `CommandApprovalQueue`
  - `QuestionQueue`
  - `PatchReviewQueue`
  - `VerificationQueue`
  - `TerminalRunList`
- Desktop workspace reload now restores the current workspace root and file tree through the desktop gateway.
- Ollama remains discovery-only and is blocked from Build execution.

Latest verification:

```bash
npm test -- --run                            # 89 passed
npm run build                                # passed
cargo test --manifest-path src-tauri/Cargo.toml # 30 passed
npm run test:e2e                              # 31 passed
npm run tauri build -- --debug                # passed in latest matrix snapshot
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
- Do not bypass `apply_workspace_patches_transactional` for Agent-generated file changes.
- Do not mark packaging complete without running a desktop debug build on the target platform.

## Recommended Next Implementation Order

### 1. Keep E2E Green

Fix any remaining Playwright failures first. This is the only quick way to know whether UI behavior matches the stated product contract.

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

- `useAgentRun`
- `usePatchWorkflow`
- `useEmbeddingIndex` (done)
- `useWindowActions` (done)

Leave `useWorkspace` as a composition layer returning a narrow view model.

### 4. Harden Runtime

Fix these seams:

- Keep `run_command` structured as `{ command, args, reason }`.
- Keep command/write/install/network actions behind Review Dock approval.
- Keep Agent patch proposals out of direct writes; apply only through sandbox preview, conflict handling, and `apply_workspace_patches_transactional`.
- Continue removing implicit workspace fallback from Rust commands.

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
