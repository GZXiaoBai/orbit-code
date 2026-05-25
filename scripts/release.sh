#!/bin/bash
set -e

echo "=== Building Agent GUI v1.0.0 ==="

# Install frontend deps
npm ci

# Build frontend
npm run build

# Build for all platforms
echo "=== Building macOS .dmg ==="
npm run tauri build -- --target aarch64-apple-darwin

echo "=== Building Windows .msi ==="
npm run tauri build -- --target x86_64-pc-windows-msvc

echo "=== Building Linux .AppImage ==="
npm run tauri build -- --target x86_64-unknown-linux-gnu

echo "=== Build complete ==="
echo "Artifacts are in src-tauri/target/release/bundle/"
