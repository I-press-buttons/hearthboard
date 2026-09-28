import path from 'node:path';

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
  /** Optional 32+ char secret; otherwise a key file is generated in dataDir. */
  secret: string | null;

  // Defaults for settings managed in the GUI (Settings → General / Admin PIN). None of these
  // need to be set; they only exist so older compose files keep working.
  /** Time zone until one is chosen in Settings. */
  timeZone: string;
  /** Seconds between calendar polls until changed in Settings. */
  syncIntervalSec: number;
  /** Initial admin PIN, used only while no PIN has been chosen in the GUI. */
  adminPin: string | null;
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
    secret: env.HEARTHBOARD_SECRET || null,
    timeZone: env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    syncIntervalSec: Math.max(15, num(env, 'HEARTHBOARD_SYNC_INTERVAL', 60)),
    adminPin: env.HEARTHBOARD_PIN || null,
    publicUrl: env.HEARTHBOARD_PUBLIC_URL?.replace(/\/+$/, '') || null,
  };
}
