# Next Tasks

Last updated: 2026-05-25.

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

- Split `Conversation.tsx` into deeper view Modules:
   - `PlanSummary`
   - `AgentTimeline`
   - `CommandApprovalCard`
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
- Added Orbit Code keychain/SQLite migration helpers so imported API keys and provider settings survive the Agent GUI rename.
- Added smart Composer paste attachment classification for code blocks, YAML plans, long text, images, PDFs, and dropped files.
- Added first-pass Provider adapter coverage for OpenRouter, xAI, Mistral, Groq, Qwen/DashScope, Kimi/Moonshot, SiliconFlow, and Zhipu/GLM.

Next:

1. Extract `StreamingMessage` if the streaming surface grows beyond the current inline node.
2. Move runtime/generated Agent status strings into an i18n-aware message layer.
3. Add E2E coverage for:
   - Send button imports Plan.
   - Real provider/key form flow with manual API smoke against OpenAI/Anthropic/Gemini/DeepSeek.
   - Composer paste/drop attachment chips and explicit YAML Plan import choice.
   - Manual API smoke for OpenRouter, xAI, Mistral, Groq, Qwen/DashScope, Kimi/Moonshot, SiliconFlow, and Zhipu/GLM.
   - Task edit/delete/reorder flow.
   - Multi-file rollback UI and sandbox retry after a failed preview.
   - Verification approval reload recovery and terminal run completion after restored command execution.

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
3. Finish GitHub publication once a repo-creation/push path is available (`gh` or a GitHub connector with create/push capability).
4. macOS debug packaging is verified; keep running it before desktop handoffs.
5. Document Windows/Linux packaging as manual until verified.
