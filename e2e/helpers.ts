import { expect, type Browser, type Page } from '@playwright/test';

const ADMIN = { username: 'admin', password: 'e2e admin password' };

/** Sign the page's browser in as the admin the e2e server starts with. */
export async function login(page: Page) {
  const res = await page.request.post('/api/auth/login', { data: ADMIN });
  expect(res.ok()).toBeTruthy();
}

/**
 * A wall display: a browser of its own that an admin has paired with a one-time link (the way a
 * script, or a person who'd rather not type a code, would), showing the board at /. It isn't
 * signed in, as a real TV isn't.
 */
export async function pairedDisplay(browser: Browser, name = 'E2E screen'): Promise<Page> {
  const admin = await browser.newContext();
  const signedIn = await admin.request.post('/api/auth/login', { data: ADMIN });
  expect(signedIn.ok()).toBeTruthy();
  const made = await admin.request.post('/api/displays', { data: { name } });
  expect(made.ok()).toBeTruthy();
  const { url } = (await made.json()) as { url: string };
  await admin.close();

  const page = await (await browser.newContext()).newPage();
  await page.goto(url);
  await page.waitForURL((u) => u.pathname === '/');
  return page;
}
