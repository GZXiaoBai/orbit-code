# Known Failures And Risks

Last updated: 2026-05-27.

## Recently Found

| Item | Status | Detail |
| --- | --- | --- |
| Composer Enter submit | fixed and verified | E2E expected Enter to import a Plan, but `textarea` did not submit forms by default. `Composer.tsx` now submits on Enter and keeps Shift+Enter for newline. |
| E2E suite | fixed and verified | `npm run test:e2e` now passes 34/34. |
| Narrow viewport layout | fixed and verified | Browser smoke at 390x844 now keeps the conversation and composer visible, hides auxiliary panels, and has no horizontal overflow. |
| Output panel default styling | fixed and verified | Right-side output, task empty state, source list, and preview chrome now use explicit CSS instead of browser-default controls. |
| Static demo front end | fixed and verified | Preloaded demo projects/output and fabricated mock diff generation were removed from the normal user path. Desktop smoke confirmed a real workspace path loads actual files and previews `package.json`. |
| Opened-project Composer regression | fixed and verified | Desktop fixture E2E now simulates an opened project with a long file tree and asserts the Composer stays visible and usable. |
| Project permission chip disabled | fixed and verified | Permission control opens global Security without a project and opens a current-project override menu with a workspace. |
| Light popover transparency | fixed and verified | Light theme surface tokens and popover backgrounds were made more solid; E2E asserts the local usage popover no longer shows file names through it. |
| Primary button hover contrast | fixed and verified | `ui-button-primary` hover specificity now keeps the open-folder button readable; E2E checks light-theme hover foreground/background contrast. |
| Settings Models page alignment | fixed and verified | Settings content is now left-aligned and compact; E2E asserts Models provider/detail positioning. |
| Agent Loop approvals | fixed and verified | `run_command` now enters a real Review Dock pending approval; fixture E2E covers approve continuing and deny not executing terminal output. |
| Agent ask_user flow | fixed and verified | `ask_user` is now a blocking question queue in Review Dock; fixture E2E covers answering and returning the result to the Agent loop. |
| Agent waiting-state recovery | fixed for pending UI | Session state now persists Agent run session, pending approvals, pending questions, patch proposals, terminal runs, and Agent events. The current run is scoped by workspace/thread/task, user actions enter an explicit continue state, and Playwright reload tests cover command approval, question, and patch review recovery. Automatic model continuation after reload is intentionally not implemented. |
| Agent continue selecting the wrong task | fixed and verified | `continueAgentRun` now resumes the existing `AgentRunSession` scope (`workspacePath + threadId + taskId + runSessionId`) and feeds the last tool result back to the model, rather than restarting the normal loop and choosing the first queued task. Vitest and E2E remain green. |
| DeepSeek malformed tool output loops | partially fixed | The Agent prompt now requires exactly one one-line JSON tool call, rejects shell operators/`cd ... && ...`, strips fabricated tool-result text, and stops after repeated invalid/no-tool responses with an actionable recovery message instead of burning all iterations silently. Real DeepSeek smoke remains required. |
| Review Dock stale queue pollution | fixed for current scope | Review Dock queue model now scopes approvals, questions, patch reviews, and terminal runs by current workspace/thread/task while retaining history separately. This reduces cross-thread/task confusion during resumed runs. |
| New thread inherited previous session | fixed and verified | Initial session restore is now one-shot, so creating a new thread no longer rehydrates old timeline events. Left-rail thread archive/delete actions are covered by Playwright. |
| Agent command execution | fixed and verified | Tool envelope and Rust tests cover structured `command` + `args` instead of shell-string execution. |
| Agent patch execution | partially fixed | Agent `apply_patch` creates a Review Dock proposal, runs temp sandbox preview, blocks real apply on sandbox failure, and has E2E coverage for approved transaction write, verification approval, local conflict stop, conflict resolution, and retry write. Failed sandbox retry and multi-file rollback UI still need coverage. |
| Provider support mismatch | partially fixed | Provider runtime and model capability inference are now split further: `modelCapabilityCatalog` owns official context/reasoning/build-support fallbacks, while provider adapters own list/chat parsing. Ollama is exposed as model discovery only and is blocked from Build execution; chat/streaming relay is still not implemented. |
| Provider smoke | partially fixed | Models settings has provider smoke state and a manual smoke action. Fixture smoke is automated; real provider smoke still requires manual API keys. |
| API import memory after rename | superseded by credential vault | Orbit no longer reads OS Keychain to avoid repeated system permission prompts. Provider settings still persist in SQLite, but users must re-enter API keys once into the Orbit encrypted credential vault. Trusted-device auto-unlock is now available for personal devices and still needs packaged-app smoke. |
| Dark code preview mismatch | fixed in code path | Monaco preview now receives the active app theme and switches between `vs` / `vs-dark`; large-file fallback uses shared theme surfaces. Needs visual smoke in the packaged app. |
| GitHub publication | unblocked | `gh` CLI is installed and authenticated for `GZXiaoBai`; direct `origin/main` push is available after full verification. |
| Workspace root | open | Many Rust commands use `std::env::current_dir()` rather than an explicit workspace/project root. |
| Docs drift | partially fixed | `AGENTS.md`, `STATUS_MATRIX.md`, `NEXT_TASKS.md`, `KNOWN_FAILURES.md` now state current truth. Keep older docs subordinate to `STATUS_MATRIX.md`. |

## Architecture Risks

- `useWorkspace.ts` remains too broad and should keep shrinking into coordinator-only responsibilities.
- Review Dock command approval cards now render command/args/risk/reason, but risk copy still needs better localization and install/network-specific detail.
- Real DeepSeek smoke remains the most important end-to-end acceptance test: Plan → Build → approval → Patch → Apply → verification approval → Terminal → summary.
- Some runtime/generated Agent messages still use Chinese fallback text, so i18n is not fully complete.
- Deeper visual QA is still needed after each UI pass, even though E2E now covers the screenshot regressions.
- Real provider model import needs manual API smoke because CI uses the fixture provider.

## Verification Rule

Do not mark an item complete unless one of these exists:

- passing automated test,
- passing build command,
- passing Browser/manual validation note,
- explicit label that it is design-only or unverified.
