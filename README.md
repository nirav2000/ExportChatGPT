# Project Archivist

Project Archivist is a **local-first** ChatGPT workspace archiver with a Tauri desktop app and Chrome extension.

## Implemented phases

### Phase 1 (scaffold + shared packages)
- pnpm workspace monorepo
- shared schema/core/exporter/extractor packages
- baseline docs and policies

### Phase 2 (desktop import/export pipeline foundation)
- Tauri commands for:
  - diagnostics (`diagnostics_health`)
  - import capture bundle JSON (`import_capture_bundle`)
  - list project/chat overview (`list_projects_chats`)
  - queue export jobs (`queue_export_job`)
- SQLite schema bootstrap (`workspaces`, `projects`, `chats`, `messages`, `export_jobs`)
- Desktop UI wired to invoke import/export/list commands when running in Tauri

### Phase 3 (extension current-chat export)
- MV3 side panel + popup fallback
- runtime optional permission request for ChatGPT host access
- current-tab chat extraction (messages + images metadata)
- local capture bundle generation in service worker
- one-click JSON bundle download via `chrome.downloads`

## Remaining (next iterations)
- Official ChatGPT export ZIP parser and importer
- Dedicated export-tab navigation walker for project/workspace scans
- Asset byte download + content hashing in extension
- Incremental export skip/force/repair logic persisted end-to-end
- Resume interrupted exports and richer diagnostics UI
- Playwright coverage for desktop and extension fixture flows

## Quick start
```bash
pnpm install
pnpm build
pnpm test
pnpm dev:desktop
pnpm --filter @project-archivist/extension build
```

## Privacy
No backend. No telemetry. Data remains local unless the user exports files.
