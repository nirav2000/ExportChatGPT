import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('extension manifest includes optional host permissions', async () => {
  const manifest = JSON.parse(readFileSync('apps/extension/manifest.json', 'utf8'));
  expect(manifest.optional_host_permissions).toContain('https://chatgpt.com/*');
});
