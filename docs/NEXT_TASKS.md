# Next Tasks

## P0

1. Turn the packaged-window smoke from launch coverage into full live Plan coverage. `npm run smoke:desktop-plan` now starts the real Tauri binary through `tauri-driver` on Linux/Windows and has an opt-in `ORBIT_DESKTOP_PLAN_LIVE=1` path for sending “你好”; the remaining gap is running that live mode in a credentialed desktop environment.
2. Commit/push the CI workflow update, then trigger the manual `desktop-build-live` workflow in the protected `orbit-live-smoke` environment. It now bootstraps an encrypted vault bundle into `ORBIT_APP_DATA_DIR`, seeds an isolated `ORBIT_DESKTOP_BUILD_WORKSPACE`, runs live readiness, then runs approved and denied `npm run smoke:desktop-build` paths under Ubuntu `xvfb`; the remaining gap is a credentialed run result, not missing wiring.
3. Finish app-server request handling verification for question/tool result/interrupt with real provider traffic, not fixture-synthesized items. Current live evidence proves initialize, thread/start, approval request/response, turn completion, terminal output, usage, final assistant summary, and file write.
4. Add sidecar crash/restart recovery tests while a Build turn is active, building on the current pending-response cleanup and early Orbit-turn attachment coverage. Composer/session duplicate-submit protection has first-pass coverage; keep expanding it through real turn state transitions.
5. Keep retry/error output stable in live desktop Build: Rust now has stable per-turn app-server error item ids; next verify reconnect warning updates and final error upserts through the packaged UI and extend `smoke:desktop-build` once a deterministic crash harness is available.
6. Add tests for `useCodexSession` streaming/retry/approval/interrupted/failed/reload recovery states beyond the current duplicate-submit lock and runtime-error coverage.

## P1

1. Keep DeepSeek as the only Build-enabled provider; keep OpenRouter, Qwen/DashScope, SiliconFlow, Kimi, Groq, and custom providers discovery-only with explicit blocked reasons.
2. Expand DeepSeek bridge tests for illegal role sanitization, orphan tool output repair, tool call result loops, usage mapping, SSE mid-stream errors, and no-secret logging.
3. Finish Settings as the Codex runtime control plane: sidecar version/path/sha256, bridge base URL, pid, last error, restart result, discovery/smoke/build states.
4. Add regression coverage for streaming caret, last-thread deletion, and empty-thread state; Markdown rendering, auto-scroll, and first-pass composer/session submit recovery already have focused coverage.

## P2

1. Turn sidecar preparation into a release-grade pipeline: platform target map, checksum validation, clear build-time error, and no committed large binaries. First-pass cleanup now keeps `src-tauri/binaries/codex-*` ignored and lets Cargo-only tests compile without a prepared sidecar.
2. Run an isolated OpenCode adapter spike behind `AgentRuntimePort`; do not connect it to production UI until it proves stable machine events and approval/file-edit semantics.
3. Revisit the visual system after the Codex loop is stable.
