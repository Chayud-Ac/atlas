import { expect, signIn, test } from './fixtures.js';

test('signing in shows who you are, and signing out asks again', async ({ page }) => {
  await signIn(page);
  // The name and email come from GET /api/users/me, so this proves the token reached the API.
  await expect(page.getByRole('banner').getByText('developer@example.com')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});
