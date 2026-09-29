import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { Auth } from './auth';
import { Boards, type TouchGate } from './boards';
import { registerCalendarRoutes } from './calendars/routes';
import { CalendarService, defaultProviderFactory, type ProviderFactory } from './calendars/service';
import { Checklists } from './checklists';
import type { Config } from './config';
import { openDb, type DB } from './db';
import { ensureDemoPhotos, seedDemo } from './demo';
import { Displays } from './displays';
import { hostAllowed, hostRefusal, publicHost } from './hosts';
import { LiveHub } from './live';
import { Meals } from './meals';
import { Notes } from './notes';
import { Photos } from './photos';
import { Quotes } from './quotes';
import { Reminders } from './reminders';
import { SecretBox } from './secrets';
import { applyTimeZone, SystemSettings } from './system';
import { Users } from './users';
import { HttpError } from './util';
import { Weather } from './weather';

export interface AppContext {
  app: FastifyInstance;
  db: DB;
  live: LiveHub;
  auth: Auth;
  displays: Displays;
  users: Users;
  boards: Boards;
  calendars: CalendarService;
  checklists: Checklists;
  reminders: Reminders;
  photos: Photos;
  quotes: Quotes;
  system: SystemSettings;
  meals: Meals;
  notes: Notes;
  weather: Weather;
}

export interface BuildOptions {
  /** Skip background timers (sync polling, daily resets); tests drive them directly. */
  background?: boolean;
  providerFactory?: ProviderFactory;
  logger?: boolean;
  /** Stand-in for Open-Meteo, for tests. */
  weatherFetch?: typeof fetch;
}

export async function buildApp(config: Config, opts: BuildOptions = {}): Promise<AppContext> {
  const background = opts.background ?? true;
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
  });
  const db = openDb(
    config.dataDir === ':memory:' ? ':memory:' : path.join(config.dataDir, 'hearthboard.db'),
  );
  const secrets =
    config.dataDir === ':memory:'
      ? new SecretBox(config.secret ?? 'test-secret')
      : SecretBox.fromConfig(config.secret, config.dataDir);
  const live = new LiveHub();
  const users = new Users(db, secrets);
  const auth = new Auth(db, users);
  const displays = new Displays(db, auth, live);
  const authWarning = await auth.init(config);
  if (authWarning) app.log.warn(authWarning);
  const system = new SystemSettings(db, config);
  applyTimeZone(system.get().timeZone);

  // A web page can point its own domain at this server and read the board as you (DNS
  // rebinding), so only answer to names that are really ours. The raw Host header is what the
  // browser used; X-Forwarded-Host is something a page could set itself.
  if (!config.allowedHosts.includes('*')) {
    app.addHook('onRequest', async (req, reply) => {
      const host = req.headers.host;
      if (!host) return;
      // The public address is read on every check, so changing it in Settings applies at once.
      if (hostAllowed(host, config.allowedHosts, () => publicHost(system.get().publicUrl))) return;
      return reply.code(421).type('text/plain; charset=utf-8').send(hostRefusal(host));
    });
  }

  let photosDir = config.photosDir;
  if (config.demo && !fs.existsSync(photosDir)) {
    photosDir = path.join(config.dataDir, 'demo-photos');
    await ensureDemoPhotos(photosDir);
  }

  const boards = new Boards(db, live);
  const checklists = new Checklists(db, live);
  const reminders = new Reminders(db, live);
  const quotes = new Quotes(db, live);
  const meals = new Meals(db, live);
  const notes = new Notes(db, live);
  const weather = new Weather({ fetch: opts.weatherFetch, demo: config.demo });
  const photos = new Photos(
    db,
    secrets,
    live,
    photosDir,
    config.dataDir === ':memory:' ? '/tmp/hearthboard-test' : config.dataDir,
  );
  const calendars = new CalendarService(
    db,
    secrets,
    live,
    opts.providerFactory ?? defaultProviderFactory,
  );

  await app.register(cookie);
  await app.register(websocket);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.code(400).send({ error: `${first.path.join('.') || 'body'}: ${first.message}` });
    }
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    req.log.error(err);
    return reply.code(502).send({ error: (err as Error).message || 'Something went wrong' });
  });

  app.get('/api/health', async () => ({ ok: true, demo: config.demo }));

  live.register(app, displays.guard);
  auth.register(app);
  displays.register(app, auth);
  users.register(app, auth, {
    createStarterBoard: (userId, name) =>
      boards.createStarter(userId, name, checklists.ensureDefault()),
    transferBoards: (fromId, toId) => boards.transfer(fromId, toId),
  });
  // Ticking from a touch-screen board needs the board's say-so and a screen that may show boards.
  const touch: TouchGate = (req, match) => displays.allows(req) && boards.touchGate(req, match);
  boards.register(app, auth, displays.guard);
  checklists.register(app, auth, displays.guard, touch);
  reminders.register(app, auth, displays.guard, touch);
  meals.register(app, auth, displays.guard);
  notes.register(app, auth, displays.guard);
  weather.register(app, auth, displays.guard);
  quotes.register(app, auth, displays.guard);
  photos.register(app, auth, displays.guard);
  system.register(app, auth);
  registerCalendarRoutes(app, calendars, auth, system, displays.guard);

  boards.ensureDefault(checklists.ensureDefault());
  if (config.demo) await seedDemo({ calendars, reminders, checklists, meals, notes });

  // Serve the built web app; client-side routes fall back to index.html.
  if (fs.existsSync(path.join(config.webDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: config.webDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && req.url !== '/ws') {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Not found' });
    });
  }

  if (background) {
    calendars.start(system.get().syncIntervalSec);
    const stopReset = checklists.startDailyReset();
    const stopExpiry = notes.startExpiry();
    app.addHook('onClose', async () => {
      calendars.stop();
      stopReset();
      stopExpiry();
    });
  }
  system.onChange((s) => {
    applyTimeZone(s.timeZone);
    calendars.reschedule(s.syncIntervalSec);
    // All-day events and daily checklist resets follow the server's zone.
    live.publish('events');
    live.publish('checklists');
  });
  app.addHook('onClose', async () => db.close());

  return {
    app,
    db,
    live,
    auth,
    displays,
    users,
    boards,
    calendars,
    checklists,
    reminders,
    photos,
    quotes,
    system,
    meals,
    notes,
    weather,
  };
}
