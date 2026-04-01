import { describe, expect, it } from 'vitest';
import { computeChatFingerprint, sanitizeFileName, sha256 } from './index';

describe('core', () => {
  it('sanitizes filenames', () => {
    expect(sanitizeFileName('bad:name?.md')).toBe('bad_name_.md');
  });

  it('hashes deterministically', () => {
    expect(sha256('x')).toBe(sha256('x'));
  });

  it('fingerprints chat messages', () => {
    const fp = computeChatFingerprint([
      { id: '1', chatId: 'c1', role: 'user', blocks: [{ type: 'paragraph', text: 'hi' }] },
    ] as any);
    expect(fp).toHaveLength(64);
  });
});
