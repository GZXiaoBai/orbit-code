# Orbit Code Status Matrix

Last audited: 2026-05-25.

This file is the current source of truth for implementation status. Historical handoff documents may contain optimistic or obsolete claims.

## Status Legend

| Status | Meaning |
| --- | --- |
| `verified` | Implemented and covered by passing local verification. |
| `partial` | Implemented enough to inspect or use, but missing coverage, edge cases, or integration. |
| `broken` | Implemented or tested, but currently failing or contract mismatch exists. |
| `design-only` | Described in docs/specs, not reliably wired into product flow. |
| `not-started` | No meaningful implementation found. |

## Verification Snapshot

| Command | Result | Notes |
| --- | --- | --- |
| `npm test -- --run` | `verified` | Vitest passes for file tree persistence, DeepSeek/provider capability fallback, credential vault prefix coverage, Composer paste attachment classification, custom run controls, context compaction, recovered approval/question helpers, Review Dock queue model, provider smoke state, and run-session resume kind coverage. |
| `npm run build` | `verified` | TypeScript and Vite build passed; Vite reports a Tauri API dynamic/static import chunk warning. |
| `cargo test --manifest-path src-tauri/Cargo.toml` | `verified` | 36 Rust tests passed, including sandbox patch preview, stale-write/path traversal coverage, provider host allowlist/model-list parsing, and SQLite legacy DB migration. |
| `npm run test:e2e` | `verified` | 31 Playwright tests passed, including real-workspace fixture, file tree + Monaco preview, Composer persistence, project permissions, settings layout, light-theme popover contrast, command approve/deny, ask_user question flow, reload recovery for pending command/question/patch review, Ollama discovery-only Build blocking, provider smoke, sandboxed patch review, transaction apply, conflict resolution, file preview refresh, and verification approval. |
| `npm run tauri build -- --debug` | `verified` | macOS `Orbit Code.app` and `Orbit Code_1.0.0_aarch64.dmg` debug bundles were produced successfully. |

## Product Surface

| Area | Status | Evidence | Risk / Next Step |
| --- | --- | --- | --- |
| App shell | `verified` | Playwright app-load tests, independent settings workspace, review dock toggle, and command palette smoke passed. | Keep layout stable while refactoring state. |
| Real workspace front end | `verified` | Desktop gateway fixture simulates a real opened project with a long file tree; Composer remains visible, files scroll independently, root folders start collapsed, file tree expansion persists per workspace, and permissions are editable. | Native folder picker exists for Tauri; keep fixture coverage for regressions. |
| Light/dark theme | `verified` | E2E theme toggle passed; light popover opacity and primary button hover contrast are covered. | Continue visual refinement, but readability regressions now have tests. |
| Chinese/English UI | `partial` | Main shell, sidebar, thread, output panel, settings, terminal, and diff copy now route through `src/i18n/copy.ts`; E2E language toggle passed. | Runtime/generated Agent messages and demo data still contain Chinese fallback strings. |
| Plan import | `verified` | Parser tests passed; E2E Plan import passed with Enter submit and Shift+Enter newline coverage. | Keep this flow green during frontend refactors. |
| Task queue editing | `partial` | Review Dock Tasks tab renders imported tasks and supports status changes. | Needs persistence verification and task edit/delete/reorder user-flow tests. |
| Conversation/timeline | `partial` | Timeline renders after Plan import and shows approval results. Thread menu and Shift+Tab mode switching are covered. | Continue reducing hard-coded runtime messages. |
| Diff viewer | `verified for core flow` | Fixture provider creates a sandbox-previewed patch proposal in Review Dock; E2E approves it, verifies transaction write, refreshes file preview, shows a verification command approval, and covers local-change conflict resolution before write. | Needs richer manual conflict editing and multiple-conflict coverage. |
| Settings/API Key UI | `partial` | Independent settings workspace, real section list, Models import surface, DeepSeek capability fallback, provider smoke state, Security matrix, Appearance preferences, Usage page, and Orbit credential-vault unlock/store flow are covered at the build/unit level. | Fixture smoke is automated; real provider model discovery still needs manual/API-key smoke after entering a vault passphrase. |
| Provider persistence | `partial` | Provider settings and imported model metadata persist in SQLite; API keys now use Orbit's encrypted credential vault instead of OS Keychain. | Existing OS Keychain entries are no longer auto-read; users must re-enter API keys once into the Orbit vault. |
| Composer attachments | `partial` | Paste classifier tests cover short text, code blocks, YAML plans, and long text; Composer now renders removable attachment chips and plan-import actions. | Needs Playwright coverage for paste/drop UI and binary attachment rendering. |

## Runtime And Agent

| Area | Status | Evidence | Risk / Next Step |
| --- | --- | --- | --- |
| Rust command registration | `verified` | `lib.rs` registers DB, file, shell, patch, LLM, embedding, window commands. | Capabilities file is minimal; audit Tauri permissions before packaging. |
| SQLite schema/CRUD | `partial` | `db.rs` has multi-table schema and Rust tests pass indirectly. | Need migration/versioning story and integration tests. |
| Credential vault | `partial` | Rust encrypts API keys with Argon2id + AES-GCM, stores only ciphertext in SQLite, and keeps decrypted keys in process memory after unlock. | Needs manual desktop validation for restart/unlock and wrong-passphrase UX on macOS/Windows/Linux. |
| File read/list | `partial` | Rust commands path-check reads and list workspace files; frontend desktop gateway now restores the current workspace root and file tree on reload. | Some backend commands still rely on `std::env::current_dir()` compatibility fallback instead of explicit workspace root. |
| Shell execution | `partial` | Async/sync commands exist with process monitor; structured `{ command, args }` Rust tests pass. | Needs more integration coverage for long-running async commands and cancellation. |
| Approval policy | `verified` | Agent `run_command` enters Review Dock approval, approve continues, deny returns a stop/replan signal and does not execute in fixture E2E. | Extend coverage to install/network-specific prompts and richer localized risk copy. |
| Transactional patch | `verified for core flow` | Rust transactional command and stale-write tests pass; Agent `apply_patch` creates a patch proposal, runs a temp sandbox preview, blocks real apply when sandbox fails, and E2E verifies approved transaction write, conflict stop, conflict resolve, retry write, and verification command card. | Add coverage for multi-file rollback UI and sandbox retry after failed preview. |
| Three-way merge | `verified` | Rust conflict tests passed. | Needs frontend E2E around conflict resolution UI. |
| Agent Loop | `partial` | `agentLoopEngine.ts` has ReAct loop, streaming, strict JSON tool envelope parsing, command approval gate, first-class ask_user question queue, patch proposal handoff, and compaction. Agent run session, pending approvals, questions, patch proposals, terminal runs, and events are persisted; reload recovery is covered for pending command approval, question, and patch review. | Full automatic model continuation after app restart is intentionally not implemented; recovered actions only perform explicit local resume work and write Agent events. |
| Semantic search / RAG | `partial` | `embedding.rs`, `semanticSearch.ts`, design spec exist; Rust embedding tests pass. | Requires OpenAI key and built index; `.gitignore` respect is not confirmed. |
| Multi-window | `partial` | Rust `window_manager.rs` and frontend button exist. | Needs desktop integration test/manual validation. |
| Packaging | `partial` | macOS debug `.app` and `.dmg` build verified on 2026-05-25. | Windows/Linux packaging remains manual/unverified. |

## Architecture Hotspots

| Module | Status | Problem |
| --- | --- | --- |
| `src/state/useWorkspace.ts` | `improved, still broad` | Session/file-system/project/layout/approval/patch/agent Modules exist, but the coordinator still wires many props and workflow callbacks. |
| `src/components/Conversation.tsx` | `improved, still partial` | Current thread UI is split into features, but runtime event rendering and composer interactions still need further view-model narrowing. |
| `src/components/thread/AgentTimeline.tsx` | `partial` | Owns timeline and patch refinement; copy now routes through i18n, but it still mixes sanitizer and Diff integration. |
| `src/features/review/ReviewDock.tsx` | `improved, still partial` | Review Dock now consumes `ReviewDockQueueModel` and delegates to `CommandApprovalQueue`, `QuestionQueue`, `PatchReviewQueue`, `VerificationQueue`, and `TerminalRunList`. Command cards show command, args, reason, workspace, and permission-action chips; patch cards show sandbox/apply status. |
| `src/runtime/toolRegistry.ts` | `partial` | Command tool aligns with structured args; patch writes are kept out of direct execution for Agent proposals. Needs more provider/tool error UX. |
| `docs/*` | `partial` | Matrix, next tasks, and known failures were refreshed for the 2026-05-25 baseline. Keep older handoff docs subordinate to this file. |

## Definition Of Done For Next Handoff

- `npm test -- --run`, `npm run build`, `cargo test --manifest-path src-tauri/Cargo.toml`, `npm run test:e2e`, and `npm run tauri build -- --debug` all pass for the claimed layer.
- `AGENTS.md`, `docs/GEMINI_DEEPSEEK_HANDOFF.md`, and this matrix agree.
- Any claimed feature has a concrete verification command or explicit manual-validation note.
- Frontend refactors reduce `useWorkspace` and `Conversation` public Interfaces instead of only moving code around.
