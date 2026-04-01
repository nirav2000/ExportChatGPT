# Chrome Extension

## Features
- MV3 background service worker
- Side panel UI with status chips + permission state
- Current chat capture (messages, assets, warnings)
- Dedicated export-tab workspace scan
- Asset byte resolution with SHA-256 hashing when fetchable
- Local capture bundle JSON download

## Load unpacked
1. Run `pnpm --filter @project-archivist/extension build`
2. Chrome -> Extensions -> Developer mode -> Load unpacked -> `apps/extension/dist`
