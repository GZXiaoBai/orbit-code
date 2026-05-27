# Next Tasks

Last updated: 2026-05-27.

This task list is prepared for GPT, Gemini, or DeepSeek handoff. Work in order unless the user changes priority.

## P0 - Restore Trust In The Baseline

Status: complete for the current baseline.

1. Latest verification:
   - `npm test -- --run`
   - `npm run build`
   - `cargo test --manifest-path src-tauri/Cargo.toml`
   - `npm run test:e2e`
   - `npm run tauri build -- --debug`
2. Keep `docs/STATUS_MATRIX.md` updated with the real result, not intended progress.

## P1 - Frontend Stabilization

Status: major stabilization complete; keep shrinking architecture and adding deeper flow coverage.

Done:

- Removed the legacy `Conversation.tsx` / `CommandApprovalCard` path.
- Split the current thread surface into deeper view Modules:
   - `ThreadCanvas`
   - `PlanSummary`
   - `AgentTimeline`
   - `EmptyThreadState`
- Added E2E coverage for:
   - Enter imports Plan.
   - Shift+Enter inserts a newline.
   - Theme toggle keeps layout stable.
   - Language toggle changes visible labels.
- Routed main visible UI copy through `src/i18n/copy.ts` for project rail, thread, review dock, settings, terminal, and diff surfaces.
- Added responsive shell rules so 390px narrow viewports keep the conversation and composer usable.
- Replaced the old output panel path with Review Dock queue and preview surfaces.
- Removed normal-path demo projects/output and fake no-model Diff generation.
- Added a real workspace path flow: set local project directory, load file tree, preview real files, and run file/shell/patch commands against the active root.
- Fixed the opened-project Composer regression with real desktop fixture coverage.
- Tightened light theme readability: local usage popover no longer bleeds through file names, and the primary open-folder hover remains high contrast.
- Reworked the independent settings workspace into a left-aligned, compact layout with a tighter Models two-pane surface.
- Improved Review Dock command cards so structured command params render as command, args, risk actions, and reason instead of raw JSON.
- Added a Review Dock queue model for command approvals, blocking questions, patch review, verification approvals, and terminal run records.
- Split Review Dock rendering into queue components for command approvals, questions, patch reviews, verification approvals, and terminal runs.
- Promoted Agent `ask_user` into a first-class question/answer flow with fixture E2E coverage.
- Persisted Agent waiting state and added reload recovery E2E for pending command approval, question, and patch review.
- Added provider smoke state and a manual smoke button in Models settings; fixture smoke is covered by Playwright.
- Added Ollama discovery-only Build blocking coverage so imported Ollama models cannot be mistaken for executable Agent models.
- Replaced OS Keychain usage with an Orbit-owned encrypted credential vault; next manual smoke should verify restart, unlock, wrong passphrase, and model refresh.
- Added smart Composer paste attachment classification for code blocks, YAML plans, long text, images, PDFs, and dropped files.
- Added first-pass Provider adapter coverage for OpenRouter, xAI, Mistral, Groq, Qwen/DashScope, Kimi/Moonshot, SiliconFlow, and Zhipu/GLM.
- Scoped Agent runs to `workspacePath + threadId + taskId + runSessionId`, so explicit continue no longer restarts from the first queued task.
- Tightened DeepSeek-facing tool instructions and malformed-output recovery: one strict JSON tool call, structured command args/cwd, no fabricated tool results, bounded correction loops.
- Improved Review Dock current-task scoping and terminal counts so historical runs do not pollute the active pending queue.
- Added typed `ThreadEvent` projection and Review Dock approval grant scopes (`once / session / project`) to reduce cross-component state guessing.
- Split official model capability fallback into `modelCapabilityCatalog`, with DeepSeek context/reasoning and Ollama discovery-only behavior covered by unit tests.
- Improved dark-theme readability for disabled Agent action buttons, select checks, Agent timeline avatars, and task status controls.
- Fixed new-thread isolation after session restore and added left-rail thread archive/delete actions with E2E coverage.

Next:

1. Extract `StreamingMessage` if the streaming surface grows beyond the current inline node.
2. Move runtime/generated Agent status strings into an i18n-aware message layer.
3. Decide whether approval grant scopes should persist across app restart; current implementation is session-memory only.
4. Add E2E coverage for:
   - Send button imports Plan.
   - Real provider/key form flow with manual API smoke against OpenAI/Anthropic/Gemini/DeepSeek.
   - Composer paste/drop attachment chips and explicit YAML Plan import choice.
   - Manual API smoke for OpenRouter, xAI, Mistral, Groq, Qwen/DashScope, Kimi/Moonshot, SiliconFlow, and Zhipu/GLM.
   - Task edit/delete/reorder flow.
   - Multi-file rollback UI and sandbox retry after a failed preview.
   - Verification approval reload recovery and terminal run completion after restored command execution.
   - Real DeepSeek small-project smoke in `/Users/zhoujunjie/PersonalProjects/test for orbit`, using the scoped single-task run state, typed ThreadEvent storage, persisted grant scopes, and explicit continue flow.
   - Explicit continue after restored verification approval and restored command completion.

## P2 - State Architecture

1. Turn `useWorkspace.ts` into a coordinator with a narrow Interface.
2. Extract Modules:
   - `useAgentRun` for Agent Loop phase, streaming, tool calls, cancellation.
   - `usePatchWorkflow` for event patches, three-way conflict checks, transaction apply, refine.
   - `useEmbeddingIndex` for build progress and index events. (done)
   - `useWindowActions` for multi-window. (done)
3. Define a `ThreadViewModel` returned to `App.tsx` so components receive fewer workflow internals.

## P3 - Runtime Safety

Done:

- Agent tool envelopes now require strict JSON and structured `run_command { command, args, reason }`.
- Rust command sync tests cover structured args.
- Agent command approval is a real pending gate; fixture E2E covers approve and deny.
- Agent `apply_patch` creates a Review Dock patch proposal instead of direct writes.
- Patch proposal now runs a temp sandbox preview before Diff review; failed sandbox previews block real workspace apply.
- Fixture E2E now covers approved transaction write, file preview refresh, and the post-patch verification command approval card.
- Fixture E2E now also covers local-change conflict detection: no transaction write before resolution, then retry write after resolving.
- Agent continuation now preserves the current run scope and returns the last approved/answered/applied/verified tool result to the same task instead of reselecting a queued task.
- ThreadEvent is now written into session/thread snapshots as a serializable storage protocol, while legacy AgentEvent remains a compatibility projection for older UI consumers.
- Session/project approval grants are persisted and restored; project grants survive thread creation/switching within the same workspace flow.
- Context compaction now emits a scoped ThreadEvent-compatible timeline record instead of only changing the internal loop state.

Next:

1. Make Rust command execution fully explicit about workspace root/project id in every remaining compatibility path.
2. Add E2E for verification approval reload recovery and terminal run completion after restored command execution.
3. Add E2E for failed sandbox preview retry and multi-file rollback messaging.
4. Add install/network-specific approval tests and more localized risk copy in Review Dock.

## P4 - Product Design Cleanup

1. Establish a distinct Agent Workbench visual direction:
   - restrained local-tool density,
   - black/white parity,
   - fewer cards,
   - less generic AI phrasing,
   - calm but recognizable brand.
2. Remove remaining Codex-like layout details that do not serve the product.
3. Use Browser screenshots at 1440x920 and one mobile-ish narrow viewport before claiming UI completion.
4. Continue reducing settings card bulk and align all setting rows to the same rhythm.

## P5 - Provider And Packaging

1. Keep Ollama explicitly model-discovery-only in Build until chat/streaming relay is implemented.
2. Run real provider-specific smoke tests manually when API keys are available; CI remains fixture-only.
3. GitHub publication is unblocked with authenticated `gh`; keep direct `main` pushes gated by the full verification suite.
4. macOS debug packaging is verified; keep running it before desktop handoffs.
5. Document Windows/Linux packaging as manual until verified.
