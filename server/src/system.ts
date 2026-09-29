import type { FastifyInstance } from 'fastify';
import {
  MIN_SYNC_INTERVAL_SEC,
  SystemSettingsPatch,
  type SystemSettingsDTO,
} from '@hearthboard/shared';
import type { Auth } from './auth';
import type { Config } from './config';
import { getSetting, setSetting, type DB } from './db';
import { HttpError } from './util';

const KEY = 'system';

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Settings that used to be environment variables. Values saved in the GUI win; until then the
 * environment (if any) supplies the default, so older compose files keep working.
 */
export class SystemSettings {
  private listeners: ((s: SystemSettingsDTO) => void)[] = [];

  constructor(
    private db: DB,
    private config: Config,
  ) {}

  get(): SystemSettingsDTO {
    const stored = getSetting<Partial<SystemSettingsDTO>>(this.db, KEY) ?? {};
    return {
      timeZone: stored.timeZone ?? this.config.timeZone,
      syncIntervalSec: Math.max(
        MIN_SYNC_INTERVAL_SEC,
        stored.syncIntervalSec ?? this.config.syncIntervalSec,
      ),
      publicUrl: stored.publicUrl !== undefined ? stored.publicUrl : this.config.publicUrl,
    };
  }

  update(patch: SystemSettingsPatch): SystemSettingsDTO {
    if (patch.timeZone !== undefined && !isValidTimeZone(patch.timeZone))
      throw new HttpError(400, `Unknown time zone: ${patch.timeZone}`);
    const stored = getSetting<Partial<SystemSettingsDTO>>(this.db, KEY) ?? {};
    const next = { ...stored };
    if (patch.timeZone !== undefined) next.timeZone = patch.timeZone;
    if (patch.syncIntervalSec !== undefined) next.syncIntervalSec = patch.syncIntervalSec;
    if (patch.publicUrl !== undefined) next.publicUrl = patch.publicUrl || null;
    setSetting(this.db, KEY, next);
    const settings = this.get();
    for (const fn of this.listeners) fn(settings);
    return settings;
  }

  onChange(fn: (s: SystemSettingsDTO) => void) {
    this.listeners.push(fn);
  }

  register(app: FastifyInstance, auth: Auth) {
    app.get('/api/system', { preHandler: auth.guard }, async () => this.get());
    // Household-wide, so admins only.
    app.put('/api/system', { preHandler: auth.adminGuard }, async (req) =>
      this.update(SystemSettingsPatch.parse(req.body)),
    );
  }
}

/** Point this process's local time (Date, setHours, getDate…) at the given zone. */
export function applyTimeZone(tz: string) {
  // Node re-reads its time zone whenever process.env.TZ is assigned.
  if (process.env.TZ !== tz) process.env.TZ = tz;
}
