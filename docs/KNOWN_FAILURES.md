# Known Failures And Risks

Last updated: 2026-05-29.

## Recently Found

| Item | Status | Detail |
| --- | --- | --- |
| Composer Enter submit | fixed and verified | E2E expected Enter to import a Plan, but `textarea` did not submit forms by default. `Composer.tsx` now submits on Enter and keeps Shift+Enter for newline. |
| E2E suite | fixed and verified | `npm run test:e2e` now passes 42/42. |
| Narrow viewport layout | fixed and verified | Browser smoke at 390x844 now keeps the conversation and composer visible, hides auxiliary panels, and has no horizontal overflow. |
| Output panel default styling | fixed and verified | Right-side output, task empty state, source list, and preview chrome now use explicit CSS instead of browser-default controls. |
| Static demo front end | fixed and verified | Preloaded demo projects/output and fabricated mock diff generation were removed from the normal user path. Desktop smoke confirmed a real workspace path loads actual files and previews `package.json`. |
| Opened-project Composer regression | fixed and verified | Desktop fixture E2E now simulates an opened project with a long file tree and asserts the Composer stays visible and usable. |
| Project permission chip disabled | fixed and verified | Permission control opens global Security without a project and opens a current-project override menu with a workspace. |
| Light popover transparency | fixed and verified | Light theme surface tokens and popover backgrounds were made more solid; E2E asserts the local usage popover no longer shows file names through it. |
| Primary button hover contrast | fixed and verified | `ui-button-primary` hover specificity now keeps the open-folder button readable; E2E checks light-theme hover foreground/background contrast. |
| Settings Models page alignment | fixed and verified | Settings content is now left-aligned and compact; E2E asserts Models provider/detail positioning. |
| Agent Loop approvals | fixed and verified | `run_command` now enters a central approval overlay with a center-thread pending action; fixture E2E covers approve continuing and deny not executing terminal output. |
| Agent ask_user flow | fixed and verified | `ask_user` is now a central structured question overlay backed by recoverable pending question state; fixture E2E covers answering and returning the result to the Agent loop. |
| Agent waiting-state recovery | fixed for pending UI | Session state now persists Agent run session, pending approvals, pending questions, patch proposals, terminal runs, and Agent events. The current run is scoped by workspace/thread/task, user actions enter an explicit continue state, and Playwright reload tests cover command approval, question, and patch review recovery. Automatic model continuation after reload is intentionally not implemented. |
| Agent continue selecting the wrong task | fixed and verified | `continueAgentRun` now resumes the existing `AgentRunSession` scope (`workspacePath + threadId + taskId + runSessionId`) and feeds the last tool result back to the model, rather than restarting the normal loop and choosing the first queued task. Vitest and E2E remain green. |
| DeepSeek malformed tool output loops | partially fixed | The Agent prompt now requires exactly one one-line JSON tool call, rejects shell operators/`cd ... && ...`, strips fabricated tool-result text, and stops after repeated invalid/no-tool responses with an actionable recovery message instead of burning all iterations silently. Real DeepSeek smoke remains required. |
| Real DeepSeek smoke | verified for current mini-lab path | Manual desktop smoke was run on 2026-05-29 with DeepSeek `deepseek-v4-flash` against `/Users/zhoujunjie/PersonalProjects/test for orbit/orbit-mini-lab`. Passing path: Plan generated a 2-task draft for `SMOKE_LEDGER_20260529.md`, user accepted Build, patch sandbox preview passed, patch applied transactionally, command approval ran `npm run test:run`, verification passed, and final summary was produced. Earlier in the same session, a taskBoard edit smoke correctly failed at sandbox preview with stale-write conflict because the target file already had local changes; keep that as a conflict-recovery regression target rather than a verified happy path. |
| Runtime permission contract | partially fixed | `PolicyEngine` and `PermissionScheduler` now decide Plan/Build tool allowance before UI approval. Plan-mode executable tools are denied without creating UI approvals, and Build-mode command/verification approvals publish durable `ActionRequired` records through `ActionRequiredController` before the unified overlay resolves them. `PermissionScheduler` returns full `ActionRequiredResolution` records so approve/deny/cancel/expired can be passed back as tool results. Dynamic project-rule decisions cannot make the effective policy more permissive. Persisted session/project grants now feed `PolicyEngine` with workspace, mode, tool, action, and cwd/path scope checks, and Active Grants can be revoked from the Inspector. `RuntimeLedger` and `ActionRequiredStore` now persist/replay blocking action state with run/tool metadata. Unit tests cover install/network ActionRequired classification and grant matching, and E2E covers install denial without terminal execution. The central overlay now has install/network-specific risk copy. Grant-revoke E2E still needs refinement. |
| Review Dock stale queue pollution | fixed for current scope | Review Dock is now an Inspector projection from the runtime ledger snapshot for patch, terminal, checkpoint, rollback, and blocking action detail. It no longer accepts legacy approval/question queues as model inputs; command/question actions remain handled by central overlays. This reduces cross-thread/task confusion during resumed runs. |
| New thread inherited previous session | fixed and verified | Initial session restore is now one-shot, so creating a new thread no longer rehydrates old timeline events. Left-rail thread archive/delete actions are covered by Playwright. |
| Long conversation list pushes file tree off rail | fixed and verified | The project thread list now has a capped flex height and its own vertical scroll, so the file tree keeps usable space above the local-usage footer. Playwright covers a long thread history at 1440x920 and verifies `.rail-files` remains visible and tall enough. |
| Agent command execution | fixed and verified | Tool envelope and Rust tests cover structured `command` + `args` instead of shell-string execution. |
| Agent patch execution | partially fixed | Agent `propose_patch` creates a center patch proposal, runs temp sandbox preview, keeps failed sandbox previews pending for retry, blocks real apply on sandbox failure, creates a pre-apply checkpoint, and has E2E coverage for failed sandbox-preview retry, approved transaction write, verification approval, local conflict stop, conflict resolution, retry write, and multi-file rollback restore/delete. Rollback is evented and exposed from Inspector history; Rust snapshot restore now restores edited files and deletes files created by a patch, and Git workspaces now use an isolated shadow repo checkpoint. Broader real-Git rollback smoke still needs coverage. |
| Controlled extension surface | fixed for v1 | `ORBIT.md`, `.orbit/rules`, `.orbit/rules.md`, user rules, read-only context providers, record-only hooks, and skill manifests now have unit/E2E coverage. Settings manages user rules; Current Context Inspector can edit fixed Orbit project rule files through a safe Rust gateway, shows injected context source/mode/token/rules/errors/disabled blocks/skills, includes rule match reasons, and confirms `permissionImpact: none`. User rules support glob/regex/policy filtering for context injection only. The 2026-05-29 DeepSeek mini-lab smoke ran with context projection visible; add a later targeted smoke with explicit project rules/skills content. |
| Provider support mismatch | partially fixed | Provider runtime and model capability inference are now split further: `modelCapabilityCatalog` owns official context/reasoning/build-support fallbacks, while provider adapters own list/chat parsing. Ollama is exposed as model discovery only and is blocked from Build execution; chat/streaming relay is still not implemented. |
| Provider smoke | partially fixed | Models settings has provider smoke state and a manual smoke action. Fixture smoke is automated; real provider smoke still requires manual API keys. |
| API import memory after rename | superseded by credential vault | Orbit no longer reads OS Keychain to avoid repeated system permission prompts. Provider settings still persist in SQLite, but users must re-enter API keys once into the Orbit encrypted credential vault. Trusted-device auto-unlock is now available for personal devices and still needs packaged-app smoke. |
| Dark code preview mismatch | fixed in code path | Monaco preview now receives the active app theme and switches between `vs` / `vs-dark`; large-file fallback uses shared theme surfaces. Needs visual smoke in the packaged app. |
| GitHub publication | unblocked | `gh` CLI is installed and authenticated for `GZXiaoBai`; direct `origin/main` push is available after full verification. |
| Workspace root | partially fixed | Agent runtime read/search/command calls now go through `WorkspaceGateway` and reject missing `workspacePath`; `search_code` uses the Rust `search_workspace_files` gateway. The Rust command module now has file/command/patch/context/provider/vault extraction entry points, but some non-Agent Rust commands still use `std::env::current_dir()` compatibility fallback. |
| Docs drift | partially fixed | `AGENTS.md`, `STATUS_MATRIX.md`, `NEXT_TASKS.md`, `KNOWN_FAILURES.md` now state current truth. Keep older docs subordinate to `STATUS_MATRIX.md`. |

## Architecture Risks

- `useWorkspace.ts` remains too broad and should keep shrinking into coordinator-only responsibilities.
- RuntimeLedger is now the selector input for pending actions, run steps, Review Dock Inspector models, the unified ActionRequired overlay, and tool-call lifecycle storage. Remaining compatibility debt is narrower: `useApprovalQueue` / `useQuestionQueue` still exist for legacy restore helpers and should not become new UI/runner inputs.
- Center approval overlays now render command/args/risk/reason and install/network-specific detail, but Inspector history still needs the same localized risk copy.
- `AgentRunKernel`, `SessionRestoreController`, and `CheckpointRestoreController` now exist, but `useAgentRun` still owns too much callback wiring around streaming, approvals, questions, patch proposal results, and terminal recording.
- Real DeepSeek smoke has a current passing mini-lab happy path, but should remain a release gate: Plan → Build → approval → Patch → Apply → verification approval → Terminal → summary. Keep adding regression cases for stale-write conflict recovery, restored verification approval, and project rules/skills context.
- Some runtime/generated Agent messages still use Chinese fallback text, so i18n is not fully complete.
- Deeper visual QA is still needed after each UI pass, even though E2E now covers the screenshot regressions.
- Real provider model import needs manual API smoke because CI uses the fixture provider.

## Verification Rule

Do not mark an item complete unless one of these exists:

- passing automated test,
- passing build command,
- passing Browser/manual validation note,
- explicit label that it is design-only or unverified.
