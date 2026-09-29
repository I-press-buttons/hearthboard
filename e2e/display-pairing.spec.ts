import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('a new screen shows a code, an admin pairs it in Settings, and the board appears', async ({
  browser,
}) => {
  // A TV that has never been paired: no board, just a code.
  const tv = await (await browser.newContext()).newPage();
  await tv.goto('/');
  await expect(tv.getByRole('heading', { name: 'Pair this screen' })).toBeVisible();
  const code = (await tv.locator('.pair-code').textContent())!;
  expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  await expect(tv.locator('.clock-time')).toHaveCount(0);
  // Nothing behind it is readable either.
  expect((await tv.request.get('/api/boards/main')).status()).toBe(401);

  const admin = await (await browser.newContext()).newPage();
  await login(admin);
  await admin.goto('/settings');
  const card = admin.locator('section.card', {
    has: admin.getByRole('heading', { name: 'Displays' }),
  });
  await card.getByLabel('Code shown on the screen').fill(code.replace('-', '').toLowerCase());
  await card.getByLabel('Name', { exact: true }).fill('Kitchen TV');
  await card.getByRole('button', { name: 'Pair', exact: true }).click();
  await expect(card.getByText('Paired “Kitchen TV”.')).toBeVisible();
  const row = card.locator('.table-row', { hasText: 'Kitchen TV' });
  await expect(row).toBeVisible();

  // The TV checks every few seconds, then loads the board by itself.
  await expect(tv.locator('.clock-time')).toBeVisible({ timeout: 15_000 });
  await expect(tv.getByRole('heading', { name: 'Pair this screen' })).toHaveCount(0);
  expect((await tv.request.get('/api/boards/main')).status()).toBe(200);

  // Rename it, then remove it: the screen is turned away at once and shows a new code.
  await row.getByRole('button', { name: 'Rename' }).click();
  const dialog = admin.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Kitchen');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(card.locator('.table-row', { hasText: 'Kitchen' })).toBeVisible();

  admin.once('dialog', (d) => void d.accept());
  await card
    .locator('.table-row', { hasText: 'Kitchen' })
    .getByRole('button', { name: 'Remove' })
    .click();
  await expect(card.locator('.table-row', { hasText: 'Kitchen' })).toHaveCount(0);
  await expect(tv.getByRole('heading', { name: 'Pair this screen' })).toBeVisible({
    timeout: 15_000,
  });
  expect((await tv.request.get('/api/boards/main')).status()).toBe(401);
});

test('any device can show the board once an admin allows it, and not before', async ({
  browser,
}) => {
  const admin = await (await browser.newContext()).newPage();
  await login(admin);
  await admin.goto('/settings');
  const card = admin.locator('section.card', {
    has: admin.getByRole('heading', { name: 'Displays' }),
  });
  const toggle = card.getByLabel('Show boards on any device, without pairing');
  await expect(toggle).not.toBeChecked();

  const tv = await (await browser.newContext()).newPage();
  await tv.goto('/');
  await expect(tv.getByRole('heading', { name: 'Pair this screen' })).toBeVisible();

  admin.once('dialog', (d) => void d.accept());
  await toggle.click(); // saves after the confirmation, so the box changes a moment later
  await expect(toggle).toBeChecked();
  await expect(card.getByText('Boards are open to everyone.')).toBeVisible();
  await tv.reload();
  await expect(tv.locator('.clock-time')).toBeVisible();

  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(card.getByText('Boards are open to everyone.')).toHaveCount(0);
  await tv.reload();
  await expect(tv.getByRole('heading', { name: 'Pair this screen' })).toBeVisible();
});
