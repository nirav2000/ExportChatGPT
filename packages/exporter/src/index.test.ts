import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportWorkspace } from './index';

describe('exporter', () => {
  it('writes manifest', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'archivist-'));
    await exportWorkspace({ workspaceId: 'w', version: 1, exportedAt: new Date().toISOString(), projects: [], chats: [], messages: [], assets: [] }, dir);
    const manifest = JSON.parse(await readFile(path.join(dir, 'Project Archivist Export', 'manifest.json'), 'utf8'));
    expect(manifest.version).toBe(1);
  });
});
