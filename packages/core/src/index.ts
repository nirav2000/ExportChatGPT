import { createHash } from 'node:crypto';
import type { Message } from '@project-archivist/schema';

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export function computeChatFingerprint(messages: Message[]): string {
  const normalized = messages.map((m) => ({
    role: m.role,
    createdAt: m.createdAt ?? '',
    blocks: m.blocks,
  }));
  return sha256(JSON.stringify(normalized));
}
