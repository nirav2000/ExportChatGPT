import { z } from 'zod';

export const SourceType = z.enum(['official_export', 'live_capture']);

export const ContentBlock = z.discriminatedUnion('type', [
  z.object({ type: z.literal('paragraph'), text: z.string() }),
  z.object({ type: z.literal('heading'), level: z.number().int().min(1).max(6), text: z.string() }),
  z.object({ type: z.literal('list'), ordered: z.boolean(), items: z.array(z.string()) }),
  z.object({ type: z.literal('code'), language: z.string().optional(), code: z.string() }),
  z.object({ type: z.literal('table'), headers: z.array(z.string()), rows: z.array(z.array(z.string())) }),
  z.object({ type: z.literal('image'), assetId: z.string(), alt: z.string().optional() }),
  z.object({ type: z.literal('link'), href: z.string().url(), text: z.string() }),
  z.object({ type: z.literal('quote'), text: z.string() }),
  z.object({ type: z.literal('unknown_html'), html: z.string() }),
]);

export const AssetSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  originalUrl: z.string().optional(),
  mimeType: z.string().optional(),
  fileName: z.string(),
  sha256: z.string(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  alt: z.string().optional(),
  createdAt: z.string(),
});

export const MessageSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  role: z.enum(['user', 'assistant', 'system', 'tool', 'unknown']),
  createdAt: z.string().optional(),
  blocks: z.array(ContentBlock),
  rawHtml: z.string().optional(),
});

export const ChatSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  title: z.string(),
  sourceType: SourceType,
  sourceRef: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  fingerprint: z.string(),
  isPartial: z.boolean().default(false),
});

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  sourceType: SourceType,
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
export type Asset = z.infer<typeof AssetSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type Chat = z.infer<typeof ChatSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type WorkspaceSnapshot = z.infer<typeof WorkspaceSnapshotSchema>;
