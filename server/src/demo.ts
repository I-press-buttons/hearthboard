import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { CalendarService } from './calendars/service';
import type { Checklists } from './checklists';
import type { Reminders } from './reminders';

const SCENES: [string, string, string][] = [
  ['Lake sunrise', '#f97316', '#1e3a8a'],
  ['Pine forest', '#14532d', '#a3e635'],
  ['Beach day', '#0ea5e9', '#fde68a'],
  ['Mountain trail', '#475569', '#e2e8f0'],
  ['Autumn park', '#b45309', '#fcd34d'],
  ['City lights', '#312e81', '#f472b6'],
];

/** Write a few generated "photos" so the photo widget has something to show in demo mode. */
export async function ensureDemoPhotos(dir: string) {
  await fs.mkdir(path.join(dir, 'Vacation'), { recursive: true });
  for (const [i, [name, a, b]] of SCENES.entries()) {
    const file = path.join(
      dir,
      i < 3 ? 'Vacation' : '',
      `${name.toLowerCase().replace(/\s+/g, '-')}.jpg`,
    );
    try {
      await fs.access(file);
      continue;
    } catch {
      /* create it */
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
      <rect width="1600" height="1200" fill="url(#g)"/>
      <circle cx="${300 + i * 180}" cy="${320 + (i % 3) * 90}" r="140" fill="#fff" fill-opacity="0.35"/>
      <path d="M0 900 L400 600 L700 820 L1050 520 L1600 900 L1600 1200 L0 1200 Z" fill="#000" fill-opacity="0.25"/>
      <text x="800" y="1080" text-anchor="middle" font-family="sans-serif" font-size="64" fill="#fff" fill-opacity="0.85">${name}</text>
    </svg>`;
    await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toFile(file);
  }
}

export async function seedDemo(opts: {
  calendars: CalendarService;
  reminders: Reminders;
  checklists: Checklists;
}) {
  if (!opts.calendars.listAccounts().some((a) => a.provider === 'demo')) {
    await opts.calendars.addAccount('demo', 'Demo family', null);
  }
  if (!opts.reminders.list().length) {
    const due = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
    opts.reminders.ingest({
      reminders: [
        { title: 'Sign field trip form', list: 'Family', due: due(1), flagged: true },
        { title: 'Call plumber', list: 'Home', due: due(0) },
        { title: 'Buy birthday gift for Sam', list: 'Family', due: due(3) },
        { title: 'Renew car registration', list: 'Home', due: due(10) },
        { title: 'Milk, eggs, bread', list: 'Groceries' },
        { title: 'Return library books', list: 'Family', due: due(-1) },
      ],
    });
  }
  if (opts.checklists.all().length < 2) {
    opts.checklists.create('Groceries', false, ['Apples', 'Oat milk', 'Coffee beans', 'Tortillas']);
  }
}
