# Roadmap

Last updated: 2026-05-24.

This roadmap starts from the audited current state in `docs/STATUS_MATRIX.md`.

## Phase 0 - Baseline Trust

Goal: make the repo honest and repeatable.

- Keep `AGENTS.md`, `docs/STATUS_MATRIX.md`, and `docs/GEMINI_DEEPSEEK_HANDOFF.md` aligned.
- Make `npm test`, `npm run build`, `cargo test --manifest-path src-tauri/Cargo.toml`, and `npm run test:e2e` pass.
- Add or update tests for Composer submit behavior.
- Record known failures in `docs/KNOWN_FAILURES.md`.

## Phase 1 - Frontend Stabilization

Goal: stop the frontend from accumulating more shallow Modules.

- Split `Conversation.tsx` into focused view Modules.
- Move hard-coded copy into `src/i18n/copy.ts` for main visible UI. (mostly done; runtime/generated messages remain)
- Keep App-level props small by introducing a thread/workspace view model.
- Add E2E coverage for Plan import, task queue, timeline, theme, and language toggle. (baseline coverage done; deeper edit flows remain)

## Phase 2 - State And Workflow Depth

Goal: reduce `useWorkspace.ts` to a coordinator.

- Extract `useAgentRun`.
- Extract `usePatchWorkflow`.
- Extract `useEmbeddingIndex`. (done)
- Extract `useWindowActions`. (done)
- Define stable Interfaces for session, runtime, patch, and Agent run Modules.

## Phase 3 - Runtime Safety

Goal: make local execution explicit and enforceable.

- Use explicit workspace/project roots in Rust commands.
- Change Agent command tools to structured `{ command, args }`.
- Route Agent patch writes through transaction and conflict handling.
- Implement real approval request state instead of auto-approval.
- Add tests for denied commands, ask-mode commands, and path traversal edge cases.

## Phase 4 - Product Identity

Goal: create a distinctive Agent Workbench, not a Codex clone.

- Preserve the efficient three-zone structure.
- Reduce cards and decorative AI-style surfaces.
- Make black and white themes equal quality.
- Use restrained, native-feeling density for coding workflows.
- Validate with Browser screenshots at desktop and narrow widths.

## Phase 5 - Provider And Model Support

Goal: make multi-model support real rather than decorative.

- Align frontend provider registry with Rust LLM gateway.
- Decide whether Ollama is local-only or fully supported through Rust.
- Add provider-specific request/streaming tests where feasible.
- Track token and request metadata consistently.

## Phase 6 - Packaging And Release

Goal: claim platform support only after verification.

- Run `npm run tauri build -- --debug` on macOS.
- Document Windows MSI and Linux AppImage as verified only after platform builds pass.
- Add signing/notarization notes.
- Confirm crash logging avoids sensitive payloads.
