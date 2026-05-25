# Release Checklist

## Required Checks

- [ ] `npm test -- --run`
- [ ] `npm run build`
- [ ] `npm run test:e2e`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] `npm run tauri build -- --debug`

## Manual Smoke

- [ ] Open a real project.
- [ ] Confirm the file tree starts collapsed and remembers expanded folders.
- [ ] Preview a file in the read-only Monaco viewer.
- [ ] Import a fixture or real provider and confirm Composer model chips update.
- [ ] Start a Build run and confirm command approval appears in Review Dock.
- [ ] Review and apply a patch through the transactional patch flow.
- [ ] Confirm API keys are not present in exported settings or localStorage.

## Publishing

- [ ] Confirm app name and bundle name are `Orbit Code`.
- [ ] Confirm icon assets render on macOS, Windows, and Linux bundles.
- [ ] Confirm README links are valid.
- [ ] Create the public GitHub repository.
- [ ] Push `main`.
- [ ] Confirm CI passes on GitHub.
