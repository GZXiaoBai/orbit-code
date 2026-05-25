## Summary

## Validation

- [ ] `npm test -- --run`
- [ ] `npm run build`
- [ ] `npm run test:e2e`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`

## Security Checklist

- [ ] No API keys or secrets are written to localStorage, SQLite, logs, or fixtures.
- [ ] File writes still go through validated Rust commands.
- [ ] Command execution remains structured and reviewable.
- [ ] Patch writes remain transactional.
