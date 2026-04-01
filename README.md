# Project Archivist

Project Archivist is a **local-first** toolkit for archiving ChatGPT workspaces by project and chat.

## Workspace
- `apps/desktop`: Tauri v2 desktop app (vanilla HTML/CSS/TS frontend)
- `apps/extension`: Chrome MV3 extension (side panel + popup fallback)
- `packages/schema`: canonical archive schema + Zod validators
- `packages/core`: hashing, filename sanitization, fingerprint helpers
- `packages/exporter`: JSON/Markdown/HTML filesystem exporter
- `packages/extractor`: DOM-first extraction helpers

## Quick start
```bash
pnpm install
pnpm build
pnpm test
pnpm dev:desktop
```

## Privacy
No backend. No telemetry. All data remains on local disk unless the user explicitly exports files.
