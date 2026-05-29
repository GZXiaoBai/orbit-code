# Next Tasks

Last updated: 2026-05-29.

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
- Replaced the old output panel path with center-thread action affordances plus Review Dock inspector surfaces.
- Removed normal-path demo projects/output and fake no-model Diff generation.
- Added a real workspace path flow: set local project directory, load file tree, preview real files, and run file/shell/patch commands against the active root.
- Fixed the opened-project Composer regression with real desktop fixture coverage.
- Tightened light theme readability: local usage popover no longer bleeds through file names, and the primary open-folder hover remains high contrast.
- Reworked the independent settings workspace into a left-aligned, compact layout with a tighter Models two-pane surface.
- Moved command/question authorization into central overlays; Review Dock now keeps inspector-style file, diff, terminal, and history surfaces.
- Added a typed Review Dock projection for patch review and terminal records from the shared thread event source.
- Promoted Agent `ask_user` into a first-class question/answer flow with fixture E2E coverage.
- Persisted Agent waiting state and added reload recovery E2E for pending command approval, question, and patch review.
- Added provider smoke state and a manual smoke button in Models settings; fixture smoke is covered by Playwright.
- Added Ollama discovery-only Build blocking coverage so imported Ollama models cannot be mistaken for executable Agent models.
- Replaced OS Keychain usage with an Orbit-owned encrypted credential vault; next manual smoke should verify restart, unlock, wrong passphrase, and model refresh.
- Added smart Composer paste attachment classification for code blocks, YAML plans, long text, images, PDFs, and dropped files.
- Added first-pass Provider adapter coverage for OpenRouter, xAI, Mistral, Groq, Qwen/DashScope, Kimi/Moonshot, SiliconFlow, and Zhipu/GLM.
- Scoped Agent runs to `workspacePath + threadId + taskId + runSessionId`, so explicit continue no longer restarts from the first queued task.
- Tightened DeepSeek-facing tool instructions and malformed-output recovery: one strict JSON tool call, structured command args/cwd, no fabricated tool results, bounded correction loops.
- Improved Review Dock current-task scoping and terminal counts so historical runs do not pollute the active inspector surface.
- Added typed `ThreadEvent` storage/projection and central approval grant scopes (`once / session / project`) to reduce cross-component state guessing.
- Split official model capability fallback into `modelCapabilityCatalog`, with DeepSeek context/reasoning and Ollama discovery-only behavior covered by unit tests.
- Improved dark-theme readability for disabled Agent action buttons, select checks, Agent timeline avatars, and task status controls.
- Fixed new-thread isolation after session restore and added left-rail thread archive/delete actions with E2E coverage.
- Added Codex-style structured question overlay and central approval overlay so blocking questions and command/verification approvals are handled from the thread surface while Review Dock remains the inspector/history surface.
- Added a unified file action menu for file tree rows, Review Dock previews, diff filenames, and Timeline rich file references, backed by a whitelisted Rust workspace-file open/reveal command.
- Added `PolicyEngine` and `PermissionScheduler` so Plan/Build permissions are decided at a runtime Seam before UI approvals.
- Added `ActionRequiredEvent` and `ThreadRuntimeStore` coverage for blocking action tool-result semantics and pending replay without restoring old Promises.
- Added read-only controlled extension adapters for `ORBIT.md`, `.orbit/rules`, accepted plan context, record-only hooks, and skill manifests.
- Split the runtime event contract into a pure `ThreadEventProtocol`; legacy `AgentEvent` conversion remains only as a compatibility/migration path.
- Added `ActionRequiredStore` persistence/projection so blocking question, approval, patch-review, and verification state can be replayed without resurrecting stale Promises.
- Added explicit `WorkspaceGateway` runtime adapters for read/list/search/command, and moved `search_code` to the Rust `search_workspace_files` gateway instead of frontend file scanning.
- Replaced Git checkpoint strategy tagging with an isolated OS-temp shadow Git repository for Git workspaces; non-Git workspaces continue using file snapshots.
- Added `RuntimeLedger` as the runtime write seam for thread events and `ActionRequired` records, with pending replay and snapshot serialization tests.
- Added a DeepSeek smoke harness that verifies the required typed event milestones and writes a failure ledger record for the first missing stage.
- Added the Current Context Inspector for read-only `ORBIT.md` / `.orbit/rules` / accepted-plan context visibility, including source, mode, token estimate, matched rules, provider errors, and `permissionImpact: none`.
- Added Context Control Center v1: Settings user rules with mode/enabled controls, Inspector editing for fixed Orbit project rule files, read-only `.orbit/skills/*/SKILL.md` discovery, and safe Rust-gateway writes for Orbit context files.
- Added Runtime item lifecycle helpers in `RuntimeLedger` and default `resumeAction` creation for pending `ActionRequired` records.
- Added a Current Context Inspector smoke-gate action that evaluates the live thread/action snapshot against the required DeepSeek typed milestones.
- Added sandbox-preview retry after a failed patch preview; failed previews stay pending and can be retried before real workspace apply.
- Added install/network approval classification coverage, plus E2E coverage that denying an install approval does not create a terminal run.
- Added `ToolCallLifecycle` and ledger snapshot projections for pending actions, Inspector, run steps, terminal runs, and checkpoint browser inputs.
- Added `SmokeRunController` so fixture providers cannot mark the DeepSeek smoke gate as passed.
- Added accepted-Plan `todoList` events and external rule import candidates (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules`) that remain disabled unless explicitly imported.
- Tightened `PolicyEngine` so dynamic project-rule decisions cannot make the effective security policy more permissive.

Next:

1. Extract `StreamingMessage` if the streaming surface grows beyond the current inline node.
2. Move runtime/generated Agent status strings into an i18n-aware message layer.
3. Decide whether approval grant scopes should persist across full app restart beyond restored session/thread snapshots.
4. Add E2E coverage for:
   - Send button imports Plan.
   - Real provider/key form flow with manual API smoke against OpenAI/Anthropic/Gemini/DeepSeek.
   - Composer paste/drop attachment chips and explicit YAML Plan import choice.
   - Manual API smoke for OpenRouter, xAI, Mistral, Groq, Qwen/DashScope, Kimi/Moonshot, SiliconFlow, and Zhipu/GLM.
   - Task edit/delete/reorder flow.
   - Verification approval reload recovery and terminal run completion after restored command execution.
   - Additional real DeepSeek small-project smoke in `/Users/zhoujunjie/PersonalProjects/test for orbit/orbit-mini-lab` for stale-write conflict recovery, restored verification approval, restart resume, and explicit project rules/skills visibility. The current happy path passed on 2026-05-29 with `SMOKE_LEDGER_20260529.md`.
   - Explicit continue after restored verification approval and restored command completion.

## P2 - State Architecture

1. Turn `useWorkspace.ts` into a coordinator with a narrow Interface.
2. Extract Modules:
   - `useAgentRun` for Agent Loop phase, streaming, tool calls, cancellation. (done; writes typed ThreadEvent directly)
   - `usePatchWorkflow` for event patches, three-way conflict checks, transaction apply, refine. (done; updates typed ThreadEvent directly)
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
- ThreadEvent is now written into session/thread snapshots as a serializable storage protocol. `useAgentRun` and `usePatchWorkflow` write through the typed ThreadEvent seam; legacy AgentEvent remains a compatibility projection for older UI consumers.
- Session/project approval grants are persisted and restored; project grants survive thread creation/switching within the same workspace flow.
- Context compaction now emits a scoped ThreadEvent-compatible timeline record instead of only changing the internal loop state.
- Rust snapshot rollback can restore modified files and delete files created by a patch; Git workspaces now create a real isolated shadow checkpoint repo under the OS temp directory, while non-Git workspaces use file snapshots.
- Runtime file/search/command tool calls now go through explicit `WorkspaceGateway` methods that reject missing workspace paths.
- Failed sandbox previews remain in the pending patch-review projection and can be retried through the same controlled sandbox command path before applying to the real workspace.
- Install/network command requests are classified as dedicated `ActionRequired` kinds before UI approval; fixture E2E covers install denial without terminal execution.
- `RuntimeLedger` can carry tool-call lifecycle and terminal-run records; `useWorkspace` now derives pending actions and run steps from a ledger snapshot rather than merging legacy approval queues.
- Context provider inspection now surfaces external assistant rule files only as disabled import candidates; these candidates do not enter prompt context and do not change permissions.

Next:

1. Make Rust command execution fully explicit about workspace root/project id in every remaining compatibility path.
2. Add E2E for verification approval reload recovery and terminal run completion after restored command execution.
3. Add more localized install/network risk copy in the central approval overlay and Inspector history.
4. Add real-project smoke coverage for user rules, `.orbit/rules`, `ORBIT.md`, and read-only skill manifests without allowing those sources to change permissions.

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
