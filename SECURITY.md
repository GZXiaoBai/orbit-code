# Security Policy

Orbit Code is a local coding-agent workbench. Please report security issues privately before public disclosure.

## Supported Versions

The project is pre-1.0 product maturity even though package metadata may use `1.0.0` during local development. Security fixes target the current `main` branch.

## Reporting A Vulnerability

Open a private advisory or contact the maintainer directly if GitHub security advisories are unavailable. Include:

- Reproduction steps.
- Whether API keys, filesystem writes, command execution, or patch application are involved.
- Operating system and app build.
- Logs with secrets removed.

## Security Expectations

- API keys must never be stored in plaintext localStorage or plaintext SQLite.
- API keys are encrypted in Orbit's local credential vault. The vault passphrase is not stored by default.
- Users may explicitly enable trusted-device auto-unlock. This stores a local encrypted unlock cache protected by filesystem permissions, and should only be used on a personal device.
- Shell commands must be structured and reviewed before execution.
- Patches must be reviewed and applied transactionally.
- Workspace path traversal must be rejected.
- Tests should cover dangerous command classification and patch rollback behavior.
