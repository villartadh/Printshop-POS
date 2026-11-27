import { expect, test } from '@playwright/test';

test.describe('Printshop POS Live Browser UX', () => {
  test('walks through first-run setup, POS checkout, global search, module navigation, and mobile responsiveness without runtime errors', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    await page.goto('/');

    // 1. Complete first-run setup if fresh DB, or sign in if reusing existing state
    const setupHeading = page.getByText('First-Run Store Setup');
    if (await setupHeading.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await page.getByLabel('Full Name').fill('Playwright Owner');
      await page.getByLabel('Username').fill('pw_admin');
      await page.getByLabel('Email (Optional)').fill('pw@printshop.local');
      await page.getByLabel('Password (6+ characters)').fill('playwright123');
      await page.getByLabel('Quick Cashier PIN (Optional, 4–6 digits)').fill('1357');
      await page.getByRole('button', { name: /Create Admin & Open POS/i }).click();
    } else {
      await page.getByRole('button', { name: 'Password Sign In' }).click();
      await page.getByLabel('Username or Email').fill('pw_admin');
      await page.getByLabel('Password').fill('playwright123');
      await page.getByRole('button', { name: 'Sign In' }).click();
    }

    // 2. Verify POS Terminal loads with services
    const searchInput = page.getByPlaceholder(/Search services, SKU, or scan barcode/i);
    await expect(searchInput).toBeVisible({ timeout: 15_000 });

    // 3. Add a custom printing item & complete cash checkout
    await page.getByTitle(/Add custom printing service/i).click();
    await page.getByLabel('Service / Item Description').fill('Playwright Custom Print');
    await page.getByRole('button', { name: 'Add to Order' }).click();

    await expect(page.getByText(/Current order \(1\)/i)).toBeVisible();
    await page.getByRole('button', { name: /Receive payment/i }).click();
    await page.getByRole('button', { name: /Complete Payment/i }).click();

    await expect(page.getByText('Document & Receipt Preview')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();

    // 4. Open Ctrl+K Global Search & navigate to Inventory Management
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: /Global workspace search/i })).toBeVisible();
    await page.getByPlaceholder(/Jump to module, service, customer/i).fill('Inventory Management');
    await page.getByRole('button', { name: /Inventory Management/i }).first().click();
    await expect(page.getByText(/Low & Out-of-Stock Alerts/i)).toBeVisible();

    // 5. Verify mobile viewport adaptation (<768px)
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
    await page.getByRole('button', { name: 'More modules and preferences' }).click();
    await expect(page.getByText('All Modules & Display')).toBeVisible();

    expect(pageErrors, `Unexpected uncaught page errors: ${pageErrors.join('; ')}`).toEqual([]);
    expect(
      consoleErrors,
      `Unexpected console errors: ${consoleErrors.join('; ')}`,
    ).toEqual([]);
  });
});
