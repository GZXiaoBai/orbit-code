# Agent Source Study

This document now records the current Codex-sidecar decision. Earlier exploratory notes have been removed from the active handoff because they described abandoned runtime experiments.

## Decision

Orbit Code uses Codex CLI as the local Agent runtime through `codex app-server`. Orbit keeps the desktop workbench, local project model, credential vault, provider bridge, and review UI.

## Why Codex

- Local Rust Agent implementation.
- Existing app-server protocol.
- Native thread, turn, and item primitives.
- Clear fit for Orbit's review-first desktop UI.
- Apache-2.0 licensing.

## Orbit Responsibilities

- Start, stop, restart, and monitor the sidecar.
- Complete JSON-RPC initialize/initialized handshake.
- Correlate requests and responses.
- Forward sidecar notifications to Tauri events.
- Generate temporary Codex config without secrets.
- Provide loopback `/v1/responses` and `/v1/models` bridge endpoints.
- Read credentials from vault memory only.
- Project Codex items into UI view models.

## Deleted Direction

Orbit no longer pursues a self-authored frontend tool loop or an experimental third-party runtime adapter. Any future Agent capability must enter through Codex sidecar or an explicitly documented replacement architecture.
