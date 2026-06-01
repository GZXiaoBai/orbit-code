# Gemini / DeepSeek Handoff

Current route: Codex sidecar first.

## What Changed

- Orbit no longer owns the Agent runtime loop.
- Thread, turn, and item data come from Codex sidecar.
- Frontend state projects Codex items into timeline, Review Dock, terminal history, approvals, and usage.
- Provider work moves behind Orbit's loopback Responses bridge.
- Old local session snapshots are disposable and unsupported for runtime resume.

## Provider Work

The production Build path currently only opens DeepSeek. The bridge catalog still includes:

- DeepSeek
- OpenRouter
- Qwen/DashScope
- SiliconFlow
- Kimi
- Groq
- Custom OpenAI-compatible base URL

Models with unstable Responses/tool behavior may be discovered and stored, but Build must be blocked with a clear reason.

Do not enable Build for additional providers from metadata alone. Each provider needs a verified adapter path with legal message history, tool calls, tool results, SSE deltas, usage mapping, and error behavior.

## Validation Target

Use these commands as the baseline:

```bash
npm test -- --run
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run test:e2e
npm run smoke:deepseek
```

Smoke command meanings:

- `npm run smoke:deepseek`: prepared Codex sidecar plus app-server routing contract smoke. This is the default smoke entry, but it still needs to be upgraded to prove a live DeepSeek Build.
- `npm run smoke:deepseek:bridge-unit`: DeepSeek bridge translation/SSE unit smoke.
- `npm run smoke:deepseek:legacy`: historical direct DeepSeek harness; it is not runtime evidence for Codex sidecar.
