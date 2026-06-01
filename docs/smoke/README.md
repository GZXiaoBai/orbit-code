# Smoke Reports

Smoke scripts write stable `latest-*.json` reports by default so the repository stays reviewable.

Set `ORBIT_SMOKE_KEEP_HISTORY=1` to also write timestamped history reports. Timestamped JSON reports are ignored by Git.

## Credentialed Desktop Build Smoke

`npm run smoke:desktop-build` runs the packaged-window Build smoke. On macOS it writes a blocked report because WKWebView has no WebDriver automation; Linux/Windows can drive the real Tauri window through `tauri-driver`.

For live Ubuntu CI, trigger the `desktop-build-live` workflow manually with `desktop_build_live=true` and configure the `orbit-live-smoke` environment secret `ORBIT_LIVE_VAULT_BUNDLE_B64`. The bundle is base64-encoded JSON:

```json
{
  "version": 1,
  "files": {
    "orbit_code.db": "<base64 encrypted Orbit SQLite database>",
    "orbit-device-unlock.key": "<base64 trusted-device unlock key file bytes>"
  }
}
```

The workflow decodes the bundle into `ORBIT_APP_DATA_DIR`, so the app and smoke scripts share a temporary encrypted vault without exposing a plaintext provider key. It also sets `ORBIT_DESKTOP_BUILD_WORKSPACE` to an isolated temporary workspace; live smoke seeds that workspace into Orbit local storage, asks Build to write only `ORBIT_DESKTOP_BUILD_SMOKE.md`, then removes that smoke file after the run.
