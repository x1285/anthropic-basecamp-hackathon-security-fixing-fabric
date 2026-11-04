// One E2E pass through the demo on the target UI. The approver and the operator are simulated by clicks.
import { test, expect } from '@playwright/test';

test('demo: fire the jsonwebtoken incident, approve, fix, verify, resolve', async ({ page }) => {
  // Projects: five projects with repos, as in the target UI.
  await page.goto('/#projects');
  await expect(page.locator('.proj-item')).toHaveCount(5);

  // Incident lab: fire the first preset.
  await page.goto('/#lab');
  await page.getByRole('button', { name: 'jsonwebtoken key confusion' }).click();
  await page.getByTestId('fire').click();

  // Runs: scan headline and the first customer notice waiting for approval.
  await expect(page.locator('.headline')).toContainText('affected repos');
  await expect(page.getByTestId('approve-notify')).toBeVisible();
  await page.getByTestId('approve-notify').click();
  await expect(page.getByTestId('approve-notify')).toHaveCount(0);
  await expect(page.locator('#wait')).toContainText('Approved');

  // Grouping and recipes: at least one group with a recipe.
  await expect(page.locator('#step-4 .gcard').first()).toBeVisible();
  await expect(page.locator('#step-5 .gcard').first()).toContainText('Complexity');

  // Fixing: the pilot runs first, then the rest in priority order.
  await page.getByTestId('run-all').click();
  await expect(page.getByTestId('run-next')).toBeDisabled();

  // Merge and deploy every open PR and deploy request (simulated operator).
  for (let i = 0; i < 10; i++) {
    const open = await page.getByTestId('verify').count();
    if (open === 0) break;
    await page.getByTestId('verify').first().click();
    await expect(page.getByTestId('verify')).toHaveCount(open - 1);
  }

  // The escalated repo carries a ticket with its attempts and manual steps.
  await expect(page.locator('#step-8')).toContainText('Ticket for');

  // Resolution notice goes out to the customers whose projects are all verified.
  await expect(page.getByTestId('approve-resolution')).toBeVisible();
  await page.getByTestId('approve-resolution').click();
  await expect(page.locator('.note', { hasText: 'Resolution sent to' })).toBeVisible();
});

test('reset restores the demo world', async ({ page }) => {
  await page.goto('/#runs');
  await page.getByTestId('reset').click();
  await page.getByTestId('reset').click();
  await expect(page.getByTestId('reset')).toHaveText('Reset demo data');
  await expect(page.locator('.run-item')).toHaveCount(0);
});
