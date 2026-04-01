import { createHash } from 'node:crypto';
import type { Message } from '@project-archivist/schema';

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\.+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export function makeSafeUniqueName(base: string, used: Set<string>): string {
  let safe = sanitizeFileName(base) || 'untitled';
  let candidate = safe;
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${safe} (${i})`;
    i += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export function computeChatFingerprint(messages: Message[], assetHashes: string[] = []): string {
  const normalized = messages.map((m) => ({
    role: m.role,
    createdAt: m.createdAt ?? m.timestamp ?? '',
    blocks: m.blocks,
  }));
  return sha256(JSON.stringify({ normalized, assetHashes: [...assetHashes].sort() }));
}
