import path from 'node:path';
import { parseAllowedHosts } from './hosts';

function num(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const v = env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  photosDir: string;
  webDir: string;
  demo: boolean;
  /** Password for an "admin" user created on first start (otherwise set up on first visit). */
  adminPassword: string | null;
  /** Recovery: reset "admin" to `adminPassword` and turn off its two-step sign-in. */
  resetAdmin: boolean;
  /** Optional 32+ char secret; otherwise a key file is generated in dataDir. */
  secret: string | null;
  /**
   * Extra names the server answers to besides IP addresses, `localhost`, single-word and
   * `.local`-style names and the public address in Settings. `*` turns the check off.
   */
  allowedHosts: string[];

  // Defaults for settings managed in the GUI (Settings → General). None of these
  // need to be set; they only exist so older compose files keep working.
  /** Time zone until one is chosen in Settings. */
  timeZone: string;
  /** Seconds between calendar polls until changed in Settings. */
  syncIntervalSec: number;
  /** Google sign-in redirect base URL until changed in Settings. */
  publicUrl: string | null;
}

export function loadConfig(env = process.env): Config {
  const dataDir = path.resolve(env.HEARTHBOARD_DATA ?? env.DATA_DIR ?? './data');
  return {
    port: num(env, 'PORT', 8080),
    host: env.HOST ?? '0.0.0.0',
    dataDir,
    photosDir: path.resolve(env.HEARTHBOARD_PHOTOS ?? '/photos'),
    webDir: path.resolve(env.HEARTHBOARD_WEB ?? path.join(import.meta.dirname, '../../web/dist')),
    demo: ['1', 'true', 'yes'].includes((env.HEARTHBOARD_DEMO ?? '').toLowerCase()),
    // HEARTHBOARD_PIN is the older name, from before individual sign-ins.
    adminPassword: env.HEARTHBOARD_ADMIN_PASSWORD || env.HEARTHBOARD_PIN || null,
    resetAdmin: ['1', 'true', 'yes'].includes((env.HEARTHBOARD_RESET_ADMIN ?? '').toLowerCase()),
    secret: env.HEARTHBOARD_SECRET || null,
    allowedHosts: parseAllowedHosts(env.HEARTHBOARD_ALLOWED_HOSTS),
    timeZone: env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    syncIntervalSec: Math.max(15, num(env, 'HEARTHBOARD_SYNC_INTERVAL', 60)),
    publicUrl: env.HEARTHBOARD_PUBLIC_URL?.replace(/\/+$/, '') || null,
  };
}
