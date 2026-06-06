# Beta Release Checklist

This checklist defines the minimum bar for an Orbit Code local-first Beta. The Beta scope is Codex sidecar + DeepSeek Build. Other providers remain discovery-only for Build until they have equivalent bridge and desktop smoke evidence.

## Required Checks

- [x] `npm test -- --run`
- [x] `npm run build`
- [x] `npm run test:e2e`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml`
- [x] `npm run smoke:plan`
- [x] `npm run smoke:deepseek`
- [x] `npm run tauri build -- --debug --no-bundle`
- [x] GitHub `desktop-build-live` workflow approve path produces a verified artifact.
- [x] GitHub `desktop-build-live` workflow deny path produces a verified artifact.
- [x] GitHub release matrix produces macOS DMG, Windows MSI, and Linux `.deb` artifacts.

Latest full CI evidence: run `27004464759`, conclusion `success`.

## Manual Smoke

- [ ] Open a real project.
- [ ] Confirm the file tree renders real workspace files and previews selected files read-only.
- [ ] Preview a file in the read-only Monaco viewer.
- [ ] Import DeepSeek, unlock the Orbit credential vault, and confirm Composer model chips update.
- [ ] In Plan mode, ask for a plan, then follow up with a short request such as "开始吧"; the assistant must use thread context.
- [ ] Accept a Plan draft and switch to Build; the UI must show that Build will use the accepted plan.
- [ ] Start a Build run and confirm command approval appears in Review Dock.
- [ ] Approve a Build command and confirm terminal output, file edit, usage, and final summary appear.
- [ ] Deny a Build command and confirm no terminal output or file edit is created.
- [ ] Review and apply a patch through the transactional patch flow.
- [ ] Trigger Settings recovery during a stuck operation and confirm the Composer unlocks without a misleading Codex error card.
- [ ] Confirm API keys are not present in exported settings, generated Codex config, smoke reports, or localStorage.

## First-Run / Blocked-State Copy

- [x] No DeepSeek credential: Settings and Composer explain that Build requires an imported and unlocked DeepSeek provider.
- [x] Vault locked: the UI points to credential unlock rather than model import.
- [x] Sidecar missing or failed: Settings shows sidecar path/version/last error and offers restart/recover.
- [x] Non-DeepSeek provider selected for Build: the UI states discovery-only / Build blocked with the provider-specific reason.
- [x] macOS WebDriver smoke: reports blocked because WKWebView has no WebDriver automation, not because the app failed.

## Publishing

- [ ] Confirm app name and bundle name are `Orbit Code`.
- [ ] Confirm icon assets render on macOS, Windows, and Linux `.deb` bundles.
- [ ] Confirm README links are valid.
- [x] Confirm CI frontend, Rust, E2E, desktop readiness, and three-platform release build jobs pass.
- [x] Upload macOS DMG, Windows MSI, and Linux `.deb` artifacts from CI.
- [x] Update `docs/STATUS_MATRIX.md`, `docs/NEXT_TASKS.md`, and `docs/smoke/latest-*.json` with the final Beta evidence.
