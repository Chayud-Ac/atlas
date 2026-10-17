import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

declare global {
  interface Window {
    reportCspViolation: (violation: string) => void;
  }
}

/**
 * Collects the Content-Security-Policy violations of every page in a browser context, across
 * reloads. A violation means the app does something the CSP forbids (ADR 0016).
 */
export async function watchCsp(context: BrowserContext): Promise<string[]> {
  const violations: string[] = [];
  await context.exposeFunction('reportCspViolation', (violation: string) => {
    violations.push(violation);
  });
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      window.reportCspViolation(
        `${event.violatedDirective} blocked ${event.blockedURI || 'inline'}`,
      );
    });
  });
  return violations;
}

/** Playwright's `test`, plus: any CSP violation in the test's page fails the test. */
export const test = base.extend<{ cspViolations: string[] }>({
  cspViolations: [
    async ({ context }, use) => {
      const violations = await watchCsp(context);
      await use(violations);
      expect(violations, 'CSP violations').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Signs in with the app's own button, as a user would, and waits for the name in the header. */
export async function signIn(page: Page, name = 'Local Developer'): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('banner').getByText(name)).toBeVisible();
}
