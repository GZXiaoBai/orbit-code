# Smoke Reports

Smoke scripts write stable `latest-*.json` reports by default so the repository stays reviewable.

Set `ORBIT_SMOKE_KEEP_HISTORY=1` to also write timestamped history reports. Timestamped JSON reports are ignored by Git.

## Credentialed Desktop Build Smoke

`npm run smoke:desktop-build` runs the packaged-window Build smoke. On macOS it writes a blocked report because WKWebView has no WebDriver automation; Linux/Windows can drive the real Tauri window through `tauri-driver`.

For live Ubuntu CI, trigger the `desktop-build-live` workflow manually with `desktop_build_live=true` and configure the `orbit-live-smoke` environment secret `ORBIT_LIVE_VAULT_BUNDLE_B64`. The bundle is base64-encoded JSON:

```json
{
  "version": 1,
  "minimized": true,
  "files": {
    "orbit_code.db": "<base64 minimized encrypted Orbit SQLite database>",
    "orbit-device-unlock.key": "<base64 trusted-device unlock key file bytes>"
  }
}
```

The workflow decodes the bundle into `ORBIT_APP_DATA_DIR`, so the app and smoke scripts share a temporary encrypted vault without exposing a plaintext provider key. It also sets `ORBIT_DESKTOP_BUILD_WORKSPACE` to an isolated temporary workspace; live smoke seeds that workspace into Orbit local storage, asks Build to write only `ORBIT_DESKTOP_BUILD_SMOKE.md`, then removes that smoke file after the run.

To create the bundle from a local Orbit profile that already has DeepSeek saved and trusted-device auto-unlock enabled, run:

```bash
npm run smoke:live-vault:export
gh secret set ORBIT_LIVE_VAULT_BUNDLE_B64 --env orbit-live-smoke < .qa/orbit-live-vault-bundle.b64
rm -f .qa/orbit-live-vault-bundle.b64
```

The export script reads `kv_store` from `orbit_code.db`, writes a minimized SQLite database containing only `credential.vault.auto_unlock` and saved credential envelopes such as `credential.vault.deepseek`, validates the trusted-device key shape, and writes the base64 bundle to `.qa/`, which is Git ignored. The bundle is still sensitive because it contains encrypted credential material plus the trusted-device unlock key; keep it private and delete it after configuring the GitHub environment secret.

`npm run smoke:live-vault:bootstrap` is the first live workflow gate. It fails fast when the protected environment secret is empty or malformed, writes `docs/smoke/latest-live-vault-bootstrap.json`, and records only structural evidence such as decoded file sizes and validation status. It does not print the bundle, trusted-device key, database contents, or provider API key. A blank `ORBIT_LIVE_VAULT_BUNDLE_B64` in the GitHub log means the `orbit-live-smoke` environment secret is not configured or was not made available to that workflow run.

On Linux CI, run packaged desktop WebDriver smokes inside both a DBus session and Xvfb, for example `dbus-run-session -- xvfb-run -a npm run smoke:desktop-plan`. The CI jobs only need a launchable `src-tauri/target/debug/orbit-code` binary, so they prepare the Codex sidecar, build the frontend, and run `cargo build --manifest-path src-tauri/Cargo.toml` instead of the full `tauri build -- --debug` packaging path. The smoke reports include request/session/overall timeout values; increase `ORBIT_WEBDRIVER_SESSION_TIMEOUT_MS` if a debug Tauri binary needs more time to create the first WRY session.
