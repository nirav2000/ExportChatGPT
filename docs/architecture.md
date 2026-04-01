# Architecture

## Layers
1. Extract (`packages/extractor`, extension content scripts)
2. Normalize/validate (`packages/schema`)
3. Merge/fingerprint (`packages/core`, desktop import pipeline)
4. Export (`packages/exporter`)

## Canonical entities
Workspace, Project, Chat, Message, ContentBlock, Asset, Attachment, CaptureJob, ExportJob, SourceRecord.

## Incremental strategy
Chat fingerprint = hash(normalized message blocks + timestamps + asset references).
