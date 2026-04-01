import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/playwright',
  retries: 0,
  use: {
    headless: true,
  },
});
