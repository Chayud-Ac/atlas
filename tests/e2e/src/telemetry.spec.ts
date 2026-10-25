import { expect, signIn, test } from './fixtures.js';

// compose.yaml gives the web app a fake connection string whose ingestion endpoint is
// http://localhost:8091/. Nothing listens there, so the test answers for it. The fixture's CSP
// check proves the CSP allows that origin and that the SDK fetches nothing else.
test('the browser sends telemetry and traces its API calls', async ({ page }) => {
  // The SDK sends a batch when the page unloads (signing in redirects to the mock issuer), or
  // else every 15 seconds.
  test.setTimeout(60_000);
  const batches: string[] = [];
  await page.route('http://localhost:8091/**', async (route) => {
    batches.push(route.request().postData() ?? '');
    await route.fulfill({ json: { itemsReceived: 1, itemsAccepted: 1, errors: [] } });
  });
  const me = page.waitForRequest('**/api/users/me');

  await signIn(page);

  // W3C trace context on the API call, so the API's spans join the browser's trace (spec §10).
  expect((await me).headers().traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
  await expect
    .poll(() => batches.join('\n'), { timeout: 30_000 })
    .toContain('"ai.cloud.role":"atlas-web"');
});
