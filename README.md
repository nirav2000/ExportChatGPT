# Project Archivist

Project Archivist is a **local-first** ChatGPT workspace archiver with a Tauri desktop app and Chrome extension.

## Implemented phases

### Phase 1 (scaffold + shared packages)
- pnpm workspace monorepo
- shared schema/core/exporter/extractor packages
- baseline docs and policies

### Phase 2 (desktop import/export pipeline)
- Tauri commands:
  - `diagnostics_health`
  - `diagnostics_report`
  - `import_capture_bundle`
  - `import_official_export_zip`
  - `list_projects_chats`
  - `queue_export_job`
  - `run_pending_export_jobs`
- SQLite schema bootstrap and persisted incremental export fingerprints
- Resume failed/queued export jobs and diagnostics counters in UI

### Phase 3/4 (extension capture + workspace scan)
- MV3 side panel + popup fallback
- Runtime optional permission request flow
- Current chat extraction with message blocks and media metadata
- Dedicated export-tab workspace scanner (`scan-workspace-nav`)
- Asset byte resolution + SHA-256 hashing (where fetchable)
- Capture bundle download

### Phase 5 (testing + polish)
- Vitest unit tests for shared packages
- Playwright coverage scaffolding for desktop shell and extension manifest flow

## Quick start
```bash
pnpm install
pnpm build
pnpm test
pnpm test:e2e
pnpm dev:desktop
pnpm --filter @project-archivist/extension build
```


## Install guides
- Desktop (macOS): `docs/install/desktop-macos.md`
- Chrome extension: `docs/install/chrome-extension.md`

## Privacy
No backend. No telemetry. Data remains local unless the user exports files.
