# Desktop Install (macOS)

This project currently runs as a developer build (no notarized public release yet).

## 1) Prerequisites

```bash
xcode-select --install
brew install node pnpm rustup-init
rustup-init -y
source "$HOME/.cargo/env"
```

## 2) Build and run in dev mode

```bash
git clone https://github.com/nirav2000/ExportChatGPT.git
cd ExportChatGPT
pnpm install
pnpm dev:desktop
```

## 3) Build a release app bundle

```bash
pnpm install
pnpm --filter @project-archivist/desktop build
cd apps/desktop/src-tauri
cargo tauri build
```

If successful on macOS, the `.app` output is generated under Tauri target bundles.

## 4) Build a DMG

Use the repository helper script:

```bash
./scripts/make-dmg.sh
```

This script requires macOS (`hdiutil`) and a successful Tauri build.
