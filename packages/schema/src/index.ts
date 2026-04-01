import { z } from 'zod';

export const SourceType = z.enum(['official_export', 'live_capture']);
export const JobStatus = z.enum(['queued', 'running', 'complete', 'partial', 'failed']);

export const ContentBlock = z.discriminatedUnion('type', [
  z.object({ type: z.literal('paragraph'), text: z.string() }),
  z.object({ type: z.literal('heading'), level: z.number().int().min(1).max(6), text: z.string() }),
  z.object({ type: z.literal('list'), ordered: z.boolean(), items: z.array(z.string()) }),
  z.object({ type: z.literal('code'), language: z.string().optional(), code: z.string() }),
  z.object({ type: z.literal('table'), headers: z.array(z.string()), rows: z.array(z.array(z.string())) }),
  z.object({ type: z.literal('image'), assetId: z.string(), alt: z.string().optional() }),
  z.object({ type: z.literal('link'), href: z.string(), text: z.string() }),
  z.object({ type: z.literal('quote'), text: z.string() }),
  z.object({ type: z.literal('unknown_html'), html: z.string() }),
]);

const BaseMeta = z.object({
  id: z.string(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  sourceType: SourceType,
  sourceRef: z.string().optional(),
  isPartial: z.boolean().default(false),
  hasErrors: z.boolean().default(false),
});

export const WorkspaceSchema = BaseMeta.extend({
  id: z.string(),
  name: z.string().default('Default Workspace'),
  importVersion: z.number().int().default(1),
  exportVersion: z.number().int().default(1),
});

export const ProjectSchema = BaseMeta.extend({
  name: z.string(),
  workspaceId: z.string(),
});

export const ChatSchema = BaseMeta.extend({
  workspaceId: z.string(),
  projectId: z.string().nullable(),
  title: z.string(),
  fingerprint: z.string(),
});

export const MessageSchema = BaseMeta.extend({
  chatId: z.string(),
  role: z.enum(['user', 'assistant', 'system', 'tool', 'unknown']),
  blocks: z.array(ContentBlock),
  rawHtml: z.string().optional(),
  timestamp: z.string().optional(),
});

export const AssetSchema = BaseMeta.extend({
  chatId: z.string(),
  messageId: z.string().optional(),
  originalUrl: z.string().optional(),
  mimeType: z.string().optional(),
  fileName: z.string(),
  sha256: z.string(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  alt: z.string().optional(),
});

export const AttachmentSchema = BaseMeta.extend({
  chatId: z.string(),
  messageId: z.string().optional(),
  name: z.string(),
  href: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().optional(),
});

export const CaptureJobSchema = BaseMeta.extend({
  status: JobStatus,
  target: z.enum(['chat', 'project', 'workspace']),
  log: z.string().optional(),
});

export const ExportJobSchema = BaseMeta.extend({
  status: JobStatus,
  mode: z.enum(['incremental', 'force', 'repair_assets']),
  target: z.enum(['chat', 'project', 'workspace']),
  log: z.string().optional(),
});

export const SourceRecordSchema = BaseMeta.extend({
  entityType: z.enum(['project', 'chat', 'message', 'asset', 'attachment']),
  entityId: z.string(),
  provenance: z.record(z.string(), z.unknown()).default({}),
});

export const CaptureBundleSchema = z.object({
  bundleVersion: z.number().int().default(1),
  capturedAt: z.string(),
  workspace: WorkspaceSchema,
  projects: z.array(ProjectSchema),
  chats: z.array(ChatSchema),
  messages: z.array(MessageSchema),
  assets: z.array(AssetSchema),
  attachments: z.array(AttachmentSchema).default([]),
  warnings: z.array(z.string()).default([]),
});

export const WorkspaceSnapshotSchema = z.object({
  workspaceId: z.string(),
  version: z.number().int(),
  exportedAt: z.string(),
  projects: z.array(ProjectSchema),
  chats: z.array(ChatSchema),
  messages: z.array(MessageSchema),
  assets: z.array(AssetSchema),
});

export type ContentBlockT = z.infer<typeof ContentBlock>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type Chat = z.infer<typeof ChatSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Attachment = z.infer<typeof AttachmentSchema>;
export type CaptureJob = z.infer<typeof CaptureJobSchema>;
export type ExportJob = z.infer<typeof ExportJobSchema>;
export type SourceRecord = z.infer<typeof SourceRecordSchema>;
export type CaptureBundle = z.infer<typeof CaptureBundleSchema>;
export type WorkspaceSnapshot = z.infer<typeof WorkspaceSnapshotSchema>;
