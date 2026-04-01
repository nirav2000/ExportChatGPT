import { test, expect } from '@playwright/test';

test('desktop shell renders nav buttons', async ({ page }) => {
  await page.goto('file://' + process.cwd() + '/apps/desktop/index.html');
  await expect(page.getByText('Project Archivist')).toBeVisible();
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText('Import Wizard')).toBeVisible();
});
