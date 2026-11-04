// One E2E pass through demo steps 1-9 (concept, section "Demo script").
// The approver and the operator are simulated: they click the approval and "Merge & Deploy" buttons.
import { test, expect } from '@playwright/test';

test('demo steps 1-9: webhook to verified fix, memory reuse on the second incident', async ({ page }) => {
  // Step 1: dashboard with 4 projects, 3 environments each, 12 customers.
  await page.goto('/');
  await expect(page.getByTestId('count-projects')).toHaveText('4');
  await expect(page.getByTestId('count-envs')).toHaveText('12');
  await expect(page.getByTestId('count-customers')).toHaveText('12');

  // Step 2: fire a critical incident from the lab (jsonwebtoken < 9.0.0).
  await page.goto('/lab');
  await page.locator('[data-file="01-OSV-2026-1001.json"] [data-testid="fire"]').click();
  await page.waitForURL(/\/runs\//);
  const runUrl = page.url();

  // Step 3: scan shows affected repos across prod and staging, with SLA countdowns.
  await expect(page.getByTestId('headline')).toContainText('6 betroffene Repos');
  await expect(page.getByTestId('scan-row').first()).toBeVisible();
  await expect(page.getByTestId('sla-row').first()).toContainText('noch');
  await expect(page.getByTestId('sla')).toContainText('Environment-Floor (keine Kunden)');

  // Step 4: the approval inbox shows one customer text; the simulated approver approves it.
  await page.goto('/inbox');
  await expect(page.getByTestId('approval')).toHaveCount(1);
  await page.getByTestId('approve').click();
  await expect(page.getByTestId('inbox-empty')).toBeVisible();
  await page.goto('/outbox');
  const copies = await page.getByTestId('outbox-row').count();
  expect(copies).toBeGreaterThanOrEqual(8);

  // Step 5: grouping shows "6 affected repos, 2 distinct fixes" with the rationale per group.
  await page.goto(runUrl);
  await expect(page.getByTestId('headline')).toContainText('2 verschiedene Fixes');
  await expect(page.getByTestId('group')).toHaveCount(2);

  // Step 6: the pilot opened a PR with green checks.
  const prs = page.getByTestId('pr');
  await expect(prs.first()).toBeVisible();
  expect(await prs.count()).toBe(5);
  await expect(prs.first()).toContainText('✓');

  // Step 7: the recipe carries learnings from the repos it was applied to.
  await page.locator('[data-testid="group"] details').first().locator('summary').click();
  await expect(page.getByTestId('learnings').first()).toContainText('recipe');

  // Step 8: one repo hits the attempt limit and is escalated with its manual steps.
  await expect(page.getByTestId('escalation')).toContainText('legacy-cms');
  await expect(page.getByTestId('escalation')).toContainText('attempt limit');

  // Merge & Deploy for every green PR (simulated operator). Each merge re-scans the environments.
  for (let i = 0; i < 5; i++) {
    await page.goto(runUrl);
    const open = await page.getByTestId('merge-deploy').count();
    await page.getByTestId('merge-deploy').first().click();
    // wait for the server action to finish before the next navigation
    await expect(page.getByTestId('merge-deploy')).toHaveCount(open - 1);
  }
  await page.goto(runUrl);
  await expect(page.getByTestId('repo-state').filter({ hasText: 'fixed' })).toHaveCount(5);
  await expect(page.getByTestId('run-status')).toHaveText('awaiting_resolution');

  // Resolution notice is approved by the simulated approver.
  await page.goto('/inbox');
  await expect(page.getByTestId('approval')).toHaveCount(1);
  await page.getByTestId('approve').click();
  await expect(page.getByTestId('inbox-empty')).toBeVisible();
  await page.goto(runUrl);
  await expect(page.getByTestId('run-status')).toHaveText('done');

  // Step 9: a second incident of the same kind reuses the recipe from memory.
  await page.goto('/lab');
  await page.locator('[data-file="03-OSV-2026-1003.json"] [data-testid="fire"]').click();
  await page.waitForURL(/\/runs\//);
  await expect(page.getByTestId('group').first()).toContainText('reused from memory');
});
