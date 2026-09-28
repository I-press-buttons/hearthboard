import { expect, test, type Page } from '@playwright/test';

async function login(page: Page) {
  const res = await page.request.post('/api/auth/login', { data: { pin: '2468' } });
  expect(res.ok()).toBeTruthy();
}

async function board(page: Page) {
  return (await page.request.get('/api/boards/main')).json();
}

test('dragging a widget in the editor moves it on an open display', async ({ page, context }) => {
  await login(page);
  const display = await context.newPage();
  await display.goto('/');
  await expect(display.locator('.clock-time')).toBeVisible();
  const before = await display
    .locator('.react-grid-item', { has: display.locator('.clock') })
    .boundingBox();

  await page.goto('/edit');
  const clockItem = page.locator('.react-grid-item', { has: page.locator('.clock') });
  const handle = clockItem.locator('.drag-handle');
  await expect(handle).toBeVisible();

  const start = (await board(page)).widgets.find((w: { type: string }) => w.type === 'clock');
  // Clear the space below the clock by removing the verse widget.
  const quote = page
    .locator('.react-grid-item', { has: page.locator('.quote') })
    .locator('.drag-handle');
  await quote.click();
  await page.getByRole('button', { name: 'Remove widget' }).click();
  await expect(page.locator('.save-state')).toHaveText('Saved');

  // Drag the clock down by roughly three grid rows.
  const box = (await handle.boundingBox())!;
  const grid = (await page.locator('.react-grid-layout').boundingBox())!;
  const rowPx = grid.height / 16;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + (rowPx * 3 * i) / 10);
  await page.mouse.up();
  await expect(page.locator('.save-state')).toHaveText('Saved');

  const moved = (await board(page)).widgets.find((w: { type: string }) => w.type === 'clock');
  expect(moved.y).toBeGreaterThan(start.y);
  expect(moved.x).toBe(start.x);

  // The display followed along over the WebSocket, without a reload.
  await expect
    .poll(
      async () =>
        (await display
          .locator('.react-grid-item', { has: display.locator('.clock') })
          .boundingBox())!.y,
    )
    .toBeGreaterThan(before!.y + 50);
});

async function teamSyncStart(page: Page): Promise<number> {
  const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const to = new Date(Date.now() + 14 * 86_400_000).toISOString();
  const evts = await (await page.request.get(`/api/events?start=${from}&end=${to}`)).json();
  return Date.parse(evts.find((e: { title: string }) => e.title === 'Team sync').start);
}

test('dragging an event on the calendar page writes it back', async ({ page }) => {
  await login(page);
  const original = await teamSyncStart(page);
  await page.goto('/calendar');
  const event = page.locator('.fc-timegrid-event', { hasText: 'Team sync' });
  // Every demo week has the weekly "Trash night", so this waits for events to load.
  await expect(page.locator('.fc-timegrid-event').first()).toBeVisible();
  if (!(await event.isVisible())) await page.locator('.fc-next-button').click(); // demo event is tomorrow
  await expect(event).toBeVisible();

  const box = (await event.boundingBox())!;
  const slot = (await page.locator('.fc-timegrid-slot-lane').first().boundingBox())!;
  // Move one hour later (two 30-minute slots).
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + 8);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x, box.y + 8 + (slot.height * 2 * i) / 10);
  await page.mouse.up();

  await expect.poll(() => teamSyncStart(page)).toBe(original + 3600_000);
});
