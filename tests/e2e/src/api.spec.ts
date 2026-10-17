import { expect, test } from './fixtures.js';

test('the API refuses a request without a token', async ({ request }) => {
  const response = await request.get('/api/notes');
  expect(response.status()).toBe(401);
  expect(response.headers()['content-type']).toContain('application/problem+json');
});
