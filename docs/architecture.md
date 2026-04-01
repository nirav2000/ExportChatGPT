# Architecture

## Layers
1. Extract (`packages/extractor`, extension content scripts)
2. Normalize/validate (`packages/schema`)
3. Merge/fingerprint (`packages/core`, desktop import pipeline)
4. Export (`packages/exporter` + desktop job runner)

## Desktop responsibilities
- Import extension capture bundles and official export ZIPs
- Persist canonical archive in SQLite
- Queue and run export jobs with incremental/force/repair modes
- Resume failed jobs and expose diagnostics

## Extension responsibilities
- DOM-first chat extraction
- Dedicated export tab scanning for workspace navigation
- Asset resolution (http/data/blob where feasible), hashing, and local bundle download
- Side-panel orchestration and runtime permission prompts

## Canonical entities
Workspace, Project, Chat, Message, ContentBlock, Asset, Attachment, CaptureJob, ExportJob, SourceRecord.

## Incremental strategy
Chat fingerprint = hash(normalized message content + timestamps + asset references).
