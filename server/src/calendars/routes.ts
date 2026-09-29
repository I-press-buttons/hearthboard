import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { EventDelete, EventInput, EventPatch } from '@hearthboard/shared';
import type { Auth } from '../auth';
import type { SystemSettings } from '../system';
import { HttpError } from '../util';
import { ICLOUD_CALDAV_URL } from './caldav';
import { normalizeFeedUrl } from './feed';
import {
  exchangeGoogleCode,
  extractAuthCode,
  googleAuthUrl,
  GOOGLE_LOOPBACK_REDIRECT,
} from './google';
import type { CalendarService } from './service';

const CalDavBody = z.object({
  name: z.string().min(1).max(100).default('iCloud'),
  preset: z.enum(['icloud', 'custom']).default('icloud'),
  serverUrl: z.string().url().optional(),
  username: z.string().min(1),
  password: z.string().min(1),
});

const FeedBody = z.object({
  url: z.string().trim().min(8).max(2000),
  /** Leave empty to use the feed's own name. */
  name: z.string().trim().max(100).optional(),
});

const GoogleStart = z.object({
  clientId: z.string().min(10),
  clientSecret: z.string().min(5),
});

const GoogleFinish = z.object({
  state: z.string().min(1),
  /** The authorization code, or the whole URL the browser ended on. */
  code: z.string().min(1),
  name: z.string().min(1).max(100).default('Google'),
});

const CalendarPatch = z.object({
  enabled: z.boolean().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  name: z.string().min(1).max(100).optional(),
  /** Let family members (not just admins) add and change events on this calendar. */
  membersCanEdit: z.boolean().optional(),
});

interface PendingGoogle {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  expires: number;
}

export function registerCalendarRoutes(
  app: FastifyInstance,
  svc: CalendarService,
  auth: Auth,
  system: SystemSettings,
) {
  const guard = { preHandler: auth.guard };
  // Connecting, removing and recolouring the household's calendars.
  const admin = { preHandler: auth.adminGuard };
  const pending = new Map<string, PendingGoogle>();

  const finishGoogle = async (state: string, codeInput: string, name: string) => {
    const p = pending.get(state);
    if (!p || p.expires < Date.now())
      throw new HttpError(400, 'That sign-in link expired. Start again.');
    const code = extractAuthCode(codeInput);
    if (!code) throw new HttpError(400, 'Could not find the code in what you pasted.');
    const refreshToken = await exchangeGoogleCode(p.clientId, p.clientSecret, code, p.redirectUri);
    pending.delete(state);
    return svc.addAccount('google', name, {
      clientId: p.clientId,
      clientSecret: p.clientSecret,
      refreshToken,
    });
  };

  // Open to displays that aren't signed in; `editable` tells each viewer what they may change.
  app.get('/api/calendars', async (req) => svc.listCalendars(auth.currentUser(req)));

  app.patch<{ Params: { id: string } }>('/api/calendars/:id', admin, async (req) => {
    svc.updateCalendar(req.params.id, CalendarPatch.parse(req.body));
    return svc.listCalendars(req.user);
  });

  app.get('/api/accounts', admin, async () => svc.listAccounts());

  app.post('/api/accounts/caldav', admin, async (req) => {
    const body = CalDavBody.parse(req.body);
    const serverUrl = body.preset === 'icloud' ? ICLOUD_CALDAV_URL : body.serverUrl;
    if (!serverUrl) throw new HttpError(400, 'Enter the CalDAV server URL.');
    return svc.addAccount('caldav', body.name, {
      serverUrl,
      username: body.username.trim(),
      password: body.password.replace(/\s+/g, body.preset === 'icloud' ? '' : ' ').trim(),
    });
  });

  // Subscribe to a read-only .ics / webcal:// feed: holidays, school, sports.
  app.post('/api/accounts/ics', admin, async (req) => {
    const body = FeedBody.parse(req.body);
    let url: string;
    try {
      url = normalizeFeedUrl(body.url);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    try {
      return await svc.addAccount('ics', body.name || null, { url });
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });

  app.post('/api/accounts/google/start', admin, async (req) => {
    const body = GoogleStart.parse(req.body);
    const { publicUrl } = system.get();
    const redirectUri = publicUrl ? `${publicUrl}/api/google/callback` : GOOGLE_LOOPBACK_REDIRECT;
    const state = crypto.randomBytes(16).toString('base64url');
    pending.set(state, { ...body, redirectUri, expires: Date.now() + 15 * 60_000 });
    return { authUrl: googleAuthUrl(body.clientId.trim(), redirectUri, state), state, redirectUri };
  });

  app.post('/api/accounts/google/finish', admin, async (req) => {
    const body = GoogleFinish.parse(req.body);
    return finishGoogle(body.state, body.code, body.name);
  });

  // Only reachable when the public address (Settings → General) points at an HTTPS name Google accepts.
  app.get<{ Querystring: { state?: string; code?: string; error?: string } }>(
    '/api/google/callback',
    async (req, reply) => {
      if (!auth.isAdmin(req)) return reply.redirect('/settings?google=login');
      if (req.query.error || !req.query.state || !req.query.code) {
        return reply.redirect(
          `/settings?google=${encodeURIComponent(req.query.error ?? 'failed')}`,
        );
      }
      try {
        await finishGoogle(req.query.state, req.query.code, 'Google');
        return reply.redirect('/settings?google=ok');
      } catch (err) {
        return reply.redirect(`/settings?google=${encodeURIComponent((err as Error).message)}`);
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/api/accounts/:id', admin, async (req) => {
    svc.removeAccount(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/accounts/:id/sync', admin, async (req) => {
    await svc.syncAccount(req.params.id, true);
    return svc.listAccounts().find((a) => a.id === req.params.id) ?? null;
  });

  app.post('/api/sync', admin, async () => {
    await svc.syncAll();
    return svc.listAccounts();
  });

  app.get<{ Querystring: { start?: string; end?: string; calendars?: string } }>(
    '/api/events',
    async (req) => {
      const start = new Date(req.query.start ?? Date.now());
      const end = new Date(req.query.end ?? start.getTime() + 7 * 86_400_000);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
        throw new HttpError(400, 'Bad date range');
      if (end.getTime() - start.getTime() > 400 * 86_400_000)
        throw new HttpError(400, 'Range too large');
      const ids = req.query.calendars?.split(',').filter(Boolean);
      return svc.events(start, end, ids, auth.currentUser(req));
    },
  );

  app.post('/api/events', guard, async (req) => {
    const input = EventInput.parse(req.body);
    if (Date.parse(input.end) < Date.parse(input.start))
      throw new HttpError(400, 'The event ends before it starts.');
    return { resourceId: await svc.createEvent(input, req.user) };
  });

  app.patch<{ Params: { id: string } }>('/api/events/:id', guard, async (req) => {
    await svc.updateEvent(req.params.id, EventPatch.parse(req.body), req.user);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/events/:id', guard, async (req) => {
    await svc.deleteEvent(req.params.id, EventDelete.parse(req.body ?? {}), req.user);
    return { ok: true };
  });
}
