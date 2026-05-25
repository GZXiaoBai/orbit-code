# Contributing

Thanks for helping improve Orbit Code.

## Ground Rules

- Keep the app local-first.
- Do not store API keys in SQLite, localStorage, logs, screenshots, or fixtures.
- Use Rust command gateways for filesystem, shell, patch, and provider relay work.
- Preserve workspace path validation and transactional patch writes.
- Avoid large UI frameworks; use the existing React primitives and CSS variables.
- Mark incomplete work honestly in docs.

## Before Opening A Pull Request

Run the affected validation set:

```bash
npm test -- --run
npm run build
npm run test:e2e
cargo test --manifest-path src-tauri/Cargo.toml
```

For Tauri or packaging changes, also run:

```bash
npm run tauri build -- --debug
```

## Areas That Need Care

- `src/state/useWorkspace.ts` should keep shrinking into smaller modules.
- Review Dock is the single operation surface for command, question, patch, and verification approval.
- Monaco preview is read-only; file writes must flow through patch review.
- Provider metadata should prefer API data and only fall back to documented capability tables.
