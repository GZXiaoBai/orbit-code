# Architecture

Last updated: 2026-05-24.

This document describes the current architecture, not the intended final product. For feature status, see `docs/STATUS_MATRIX.md`.

## Stack

- Desktop shell: Tauri 2.
- Frontend: React 19, TypeScript, Vite.
- Styling: plain CSS modules imported from `src/styles/*.css`.
- Validation: Zod.
- Plan parsing: YAML.
- Local runtime: Rust commands through Tauri invoke.
- Storage: SQLite through Rust commands with localStorage fallback in web/test contexts.
- Credentials: Orbit-owned encrypted local vault, stored as ciphertext in SQLite and unlocked into process memory with a user passphrase.
- Tests: Vitest, Playwright, Cargo test.

## Frontend Layers

### App Shell

`src/App.tsx` wires the layout:

- `WorkbenchShell`
- `ProjectRail`
- `ThreadCanvas`
- `ReviewDock`
- `SettingsWorkspace`

It currently passes too many raw fields from `useWorkspace`. The next architecture step is to return a smaller view model from state Modules.

### UI Modules

`src/features/` and `src/components/` contain current surfaces:

- `ThreadCanvas` - central thread, Plan summary, Agent timeline, composer, and thread actions.
- `Composer` - text/file Plan import and Plan/Build run controls.
- `ReviewDock` - command approvals, questions, patch review, verification, terminal runs, and file preview.
- `ProjectRail` - project navigation, real file tree, usage popover, and project actions.
- `DiffViewer` - line Diff and conflict display.

The old `Conversation.tsx` path has been removed. `ThreadCanvas` is now the central composition layer; continue moving runtime display logic into focused view models before adding more UI behavior.

### State Modules

Current state Modules:

- `useWorkspace` - main coordinator; still too large.
- `useSession` - Plan/provider/session state.
- `useFileSystem` - workspace files, command logs, command status.
- `agentLoopEngine` - ReAct-style Agent Loop class.

Target direction:

- `useWorkspace` should become a composition layer.
- Agent run, patch workflow, embedding index, and window actions should become separate deep Modules.

### Runtime Modules

- `approvalPolicy.ts` classifies command risk.
- `toolRegistry.ts` defines Agent tools and their frontend Adapters.
- `semanticSearch.ts` gathers task context using vector search when available and fallback search otherwise.
- `projectAnalyzer.ts` identifies project shape.

Known issue: `toolRegistry.ts` and Rust command signatures are not fully aligned for command execution and transactional patching.

## Backend Layers

### Tauri Command Gateway

`src-tauri/src/lib.rs` registers commands. `src-tauri/src/commands.rs` implements:

- credentials,
- file tree/read,
- shell execution,
- patch application,
- code graph/symbol index,
- embeddings,
- merge conflict resolution,
- LLM relay.

Known issue: many commands infer the workspace from `std::env::current_dir()`. Future work should pass explicit workspace/project roots.

### Persistence

`src-tauri/src/db.rs` owns SQLite schema and CRUD for projects, threads, messages, plans, tasks, runtime events, permission requests, provider configs, and session state.

Frontend adapters:

- `sessionStore.ts`
- `tauriStorage.ts`
- `workspaceStorage.ts`
- `keychain.ts`

API keys must stay out of plaintext localStorage/SQLite. New credentials are encrypted in the Orbit credential vault; the vault passphrase is never stored.

### Code Intelligence

- `ast_parser.rs` wraps tree-sitter parsing.
- `code_graph.rs` builds symbols/imports/exports.
- `embedding.rs` stores and searches code embeddings.

The vector path requires an OpenAI API key and a built index.

## Critical Seams

| Seam | Current Adapter | Target |
| --- | --- | --- |
| Plan import | `Composer` -> `useSession.importPlan` | Keep small; add Enter/Shift+Enter tests. |
| Runtime tools | `toolRegistry.ts` -> Tauri commands | Align command args and transactional patching. |
| Patch application | UI patch flow -> `resolve_patch_conflict` -> `apply_workspace_patches_transactional` | Make Agent tools use the same seam. |
| Approval | `approvalPolicy.ts` + UI cards | Replace auto-approval with real pending user decisions. |
| Storage | `sessionStore` / `tauriStorage` / localStorage fallback | Add schema/version/migration strategy. |
| Workspace root | `current_dir()` | Explicit workspace/project root everywhere. |

## Architecture Rule

Prefer deeper Modules: small Interfaces with real Leverage and Locality. Do not split files merely to distribute complexity; split where the caller can know less.
