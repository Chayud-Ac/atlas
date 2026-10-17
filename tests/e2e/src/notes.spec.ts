import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, signIn, test, watchCsp } from './fixtures.js';

// The database is shared by every test and by manual testing, so each test only looks for notes it
// created itself, by a unique title.
function uniqueTitle(label: string): string {
  return `${label} ${randomUUID().slice(0, 8)}`;
}

async function addNote(page: Page, title: string): Promise<void> {
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Body').fill('Written by Playwright');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(notes(page).getByText(title)).toBeVisible();
}

function notes(page: Page) {
  return page.getByRole('list', { name: 'Notes' });
}

test('a note survives a reload and can be deleted', async ({ page }) => {
  const title = uniqueTitle('E2E note');
  await signIn(page);
  await addNote(page, title);

  await page.reload();
  await expect(notes(page).getByText(title)).toBeVisible();

  await page.getByRole('button', { name: `Delete ${title}` }).click();
  await expect(page.getByText(title)).toHaveCount(0);
});

test('users see only their own notes', async ({ page, browser }) => {
  const mine = uniqueTitle('First user note');
  const theirs = uniqueTitle('Second user note');
  await signIn(page);
  await addNote(page, mine);

  // A second browser session, signed in as the mock's second test user (ADR 0009). The app asks
  // the mock for a token with the clientId from /config.json, so the test changes that value.
  const other = await browser.newContext();
  const otherViolations = await watchCsp(other);
  const otherPage = await other.newPage();
  await otherPage.route('/config.json', async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as { auth: { clientId: string } };
    config.auth.clientId = 'atlas-e2e-second-user';
    await route.fulfill({ response, json: config });
  });
  await signIn(otherPage, 'Second User');
  await addNote(otherPage, theirs);
  await expect(otherPage.getByText(mine)).toHaveCount(0);

  await page.reload();
  await expect(notes(page).getByText(mine)).toBeVisible();
  await expect(page.getByText(theirs)).toHaveCount(0);

  // Clean up, as each user.
  await page.getByRole('button', { name: `Delete ${mine}` }).click();
  await otherPage.getByRole('button', { name: `Delete ${theirs}` }).click();
  await expect(otherPage.getByText(theirs)).toHaveCount(0);
  await other.close();
  expect(otherViolations, 'CSP violations (second user)').toEqual([]);
});
