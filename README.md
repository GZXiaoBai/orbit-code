# Orbit Code

Orbit Code is a local-first, multi-model coding agent workbench built with Tauri, React, TypeScript, and Rust. It is designed for reviewing and approving local coding-agent work instead of blindly handing your filesystem to a model.

The project is active and in a two-week Beta stabilization push. The Beta scope is Codex sidecar plus DeepSeek Build: Plan and ordinary chat use the direct provider route, while Build runs through `codex app-server` and Orbit's loopback Responses bridge. Other providers remain discovery-only for Build until they have equivalent bridge and desktop smoke evidence.

## What It Does

- Open a local project and browse a real file tree.
- Preview code with a read-only Monaco viewer.
- Import model providers and only show models returned by the provider API.
- Store provider API keys in Orbit's encrypted local credential vault instead of the OS Keychain.
- Run a single coding task through Plan / Build modes, with accepted Plan drafts carried into Build.
- Route commands, questions, patch proposals, and verification runs through Review Dock.
- Apply file changes through patch review and transactional Rust-side writes.
- Preserve local-first state for projects, layout, file tree expansion, and run controls.

## Current Status

Read these before assuming a feature is complete:

- [AGENTS.md](AGENTS.md)
- [docs/STATUS_MATRIX.md](docs/STATUS_MATRIX.md)
- [docs/NEXT_TASKS.md](docs/NEXT_TASKS.md)
- [docs/KNOWN_FAILURES.md](docs/KNOWN_FAILURES.md)

Status labels in docs should use `verified`, `partial`, `design-only`, `broken`, or `not-started`.

## Stack

- Desktop: Tauri 2
- Frontend: React 19, TypeScript 5.8, Vite 7
- Editor preview: Monaco, read-only
- Styling: plain CSS variables and project-owned primitives
- Backend: Rust commands, SQLite, encrypted credential vault, reqwest
- Testing: Vitest, Playwright, Cargo test

## Development

```bash
npm install
npm run dev -- --host 127.0.0.1
```

Run the desktop app:

```bash
npm run tauri dev
```

Run validation:

```bash
npm test -- --run
npm run build
npm run test:e2e
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build -- --debug
```

## Security Model

Orbit Code is local-first, but it is still a tool that can inspect and change source code. The default safety model is:

- API keys are encrypted into local SQLite with an Orbit credential-vault passphrase. The passphrase is not persisted by default.
- A trusted-device auto-unlock option can be enabled on personal machines. It uses a local encrypted unlock cache protected by filesystem permissions, and can be disabled from Settings.
- File and patch operations go through Rust workspace path validation.
- Multi-file writes use transactional patch application and stale-write checks.
- Commands and writes are reviewed in Review Dock before execution.
- Dangerous commands are classified and blocked or escalated before execution.
- Patch proposals do not directly write to the current project.

## Provider Notes

Models only appear in the Composer after a provider is imported from Settings. Provider capability metadata is derived from API results first, then official capability tables or manual fallbacks where APIs omit context length or reasoning support.

Current provider targets include OpenAI, Anthropic, Google Gemini, DeepSeek, OpenRouter, xAI, Mistral, Groq, Qwen/DashScope, Kimi/Moonshot, SiliconFlow, Zhipu/GLM, and Ollama discovery.

DeepSeek is the only Build-enabled provider in the Beta line. Ollama and hosted OpenAI-compatible providers are intentionally discovery-only for Build until each bridge path has verified live desktop evidence.

## Release

See [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md).

## License

MIT. See [LICENSE](LICENSE).
