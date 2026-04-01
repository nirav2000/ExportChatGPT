import { describe, expect, it } from 'vitest';
import { WorkspaceSnapshotSchema } from './index';

describe('schema', () => {
  it('validates snapshot', () => {
    const parsed = WorkspaceSnapshotSchema.parse({
      workspaceId: 'ws1',
      version: 1,
      exportedAt: new Date().toISOString(),
      projects: [],
      chats: [],
      messages: [],
      assets: [],
    });
    expect(parsed.workspaceId).toBe('ws1');
  });
});
