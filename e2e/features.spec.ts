import { expect, test, type Page } from '@playwright/test';
import { login, pairedDisplay } from './helpers';

/** The browser and server run in America/Chicago; this test process may not. */
const ZONE = 'America/Chicago';
const zoned = (d: Date, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: ZONE, ...opts }).format(d);
const ymdIn = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(d);

async function mainBoard(page: Page) {
  return (await page.request.get('/api/boards/main')).json();
}

test('quick add turns a line of text into an event', async ({ page }) => {
  await login(page);
  await page.goto('/calendar');
  const box = page.getByLabel('Quick add');
  await box.fill('Piano recital tomorrow 6:30pm @ School hall');
  await expect(page.locator('.quick-add-preview')).toContainText('Piano recital');
  await expect(page.locator('.quick-add-preview')).toContainText('6:30');
  await expect(page.locator('.quick-add-preview')).toContainText('School hall');
  await box.press('Enter');
  await expect(page.locator('.quick-add-preview')).toContainText('Added “Piano recital”');
  await expect(box).toHaveValue('');

  const tomorrow = ymdIn(new Date(Date.now() + 86_400_000));
  const from = new Date(Date.now() - 86_400_000).toISOString();
  const to = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const events = await (await page.request.get(`/api/events?start=${from}&end=${to}`)).json();
  const recital = events.find((e: { title: string }) => e.title === 'Piano recital');
  expect(recital).toMatchObject({ location: 'School hall', allDay: false });
  // Browser and server both run in America/Chicago.
  const start = new Date(recital.start);
  expect(ymdIn(start)).toBe(tomorrow);
  expect(zoned(start, { hour: 'numeric', minute: '2-digit' })).toBe('6:30 PM');
});

test('removing a widget can be undone and redone from the keyboard', async ({ page }) => {
  await login(page);
  await page.goto('/edit');
  const before = (await mainBoard(page)).widgets.length;
  await page
    .locator('.react-grid-item', { has: page.locator('.clock') })
    .locator('.drag-handle')
    .click();
  await page.keyboard.press('Delete');
  await expect(page.getByRole('status')).toContainText('Widget removed');
  await expect(page.locator('.save-state')).toHaveText('Saved');
  expect((await mainBoard(page)).widgets).toHaveLength(before - 1);

  await page.keyboard.press('Control+z');
  await expect(page.locator('.clock')).toBeVisible();
  await expect.poll(async () => (await mainBoard(page)).widgets.length).toBe(before);

  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.clock')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await expect(page.locator('.clock')).toBeVisible();
  await expect.poll(async () => (await mainBoard(page)).widgets.length).toBe(before);

  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
});

test('a touch-screen board lets anyone tick its checklist', async ({ page, browser }) => {
  await login(page);
  const board = await mainBoard(page);
  const listId = board.widgets.find((w: { type: string }) => w.type === 'checklist').config
    .checklistId;
  const items = async () =>
    (await (await page.request.get(`/api/checklists/${listId}`)).json()).items;
  const first = (await items())[0];
  expect(first.done).toBe(false);

  const tablet = await pairedDisplay(browser, 'Wall tablet');
  const check = tablet.locator('.list li', { hasText: first.text }).locator('button.check');
  // Read-only until touch-screen mode is on.
  await check.click();
  await tablet.waitForTimeout(500);
  expect((await items())[0].done).toBe(false);

  await page.request.put('/api/boards/main', { data: { ...board, interactive: true } });
  await check.click();
  await expect.poll(async () => (await items())[0].done).toBe(true);
  await expect(check).toHaveClass(/on/);

  await page.request.put('/api/boards/main', { data: { ...board, interactive: false } });
});

test('a scheduled board takes over the screen, with notes posted from the Family page', async ({
  page,
  browser,
}) => {
  await login(page);
  const morning = await (
    await page.request.post('/api/boards', { data: { name: 'Morning' } })
  ).json();
  const soon = ymdIn(new Date(Date.now() + 5 * 86_400_000));
  await page.request.put(`/api/boards/${morning.id}`, {
    data: {
      ...morning,
      widgets: [
        {
          id: 'wx',
          type: 'weather',
          x: 0,
          y: 0,
          w: 8,
          h: 6,
          config: { latitude: 40.7, longitude: -74, place: 'Home' },
        },
        {
          id: 'cd',
          type: 'countdown',
          x: 8,
          y: 0,
          w: 8,
          h: 6,
          config: {
            title: 'Coming up',
            entries: [
              {
                title: 'Beach trip',
                emoji: '🏖️',
                date: soon,
              },
            ],
          },
        },
        { id: 'ml', type: 'meals', x: 16, y: 0, w: 8, h: 10, config: {} },
        { id: 'nt', type: 'notes', x: 0, y: 6, w: 16, h: 6, config: {} },
      ],
    },
  });
  const main = await mainBoard(page);
  await page.request.put('/api/boards/main', {
    data: { ...main, schedule: [{ boardId: morning.id, start: '00:00', end: '23:59' }] },
  });

  const display = await pairedDisplay(browser);
  await expect(display.locator('.weather-temp')).toContainText('°');
  await expect(display.locator('.countdown')).toContainText('Beach trip');
  await expect(display.locator('.countdown-num').first()).toContainText('5');
  await expect(display.locator('.meals')).toContainText('Today');

  // Post a note from a phone; it shows up straight away.
  await page.goto('/family');
  await page.getByLabel('Note', { exact: true }).fill('Soccer is cancelled today!');
  await page.getByRole('radio', { name: 'blue' }).click();
  await page.getByRole('button', { name: 'Post note' }).click();
  await expect(
    display.locator('.sticky-note', { hasText: 'Soccer is cancelled today!' }),
  ).toBeVisible();

  // Plan a meal; the widget updates too.
  const weekday = zoned(new Date(), { weekday: 'long' });
  await page.getByLabel(`Dinner on ${weekday}`).fill('Lasagna');
  await page.getByLabel(`Dinner on ${weekday}`).press('Enter');
  await expect(display.locator('.meals li.is-today')).toContainText('Lasagna');

  // Without the schedule, the screen goes back to its own board.
  await page.request.put('/api/boards/main', { data: { ...main, schedule: [] } });
  await expect(display.locator('.weather')).toHaveCount(0);
  await expect(display.locator('.clock-time')).toBeVisible();
});

test('a board layout exports and imports as a new board', async ({ page }) => {
  await login(page);
  await page.goto('/edit');
  await page.getByRole('button', { name: /Board/ }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export layout' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('hearthboard-home.json');
  const path = await file.path();

  await page.locator('input[type=file]').setInputFiles(path);
  await expect(page.getByRole('status')).toContainText('Imported “Home” as a new board');
  await expect(page.locator('.topbar select option:checked')).toHaveText('Home');
  expect(new URL(page.url()).searchParams.get('board')).not.toBeNull();
});
