import path from 'node:path';

function num(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const v = env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Which X-Forwarded-* headers to believe. Off unless set: otherwise anyone could pick their own
 * IP address and dodge the sign-in lockout. `true` trusts any proxy; anything else is a
 * comma-separated list of the proxy's addresses or CIDR ranges.
 */
/**
 * Sites allowed to show Hearthboard in a frame, such as a Home Assistant dashboard. None by
 * default. Addresses like http://homeassistant.local:8123, separated by commas or spaces.
 */
function embedOrigins(v: string | undefined): string[] {
  const list = (v ?? '').split(/[\s,]+/).filter(Boolean);
  for (const s of list) {
    if (!/^(https?:\/\/)?[a-z0-9.*-]+(:(\d+|\*))?\/?$/i.test(s))
      throw new Error(
        `HEARTHBOARD_EMBED_ORIGINS: "${s}" isn't an address like http://homeassistant.local:8123`,
      );
  }
  return list.map((s) => s.replace(/\/$/, ''));
}

function trustProxy(v: string | undefined): boolean | string {
  if (!v || ['0', 'false', 'no'].includes(v.toLowerCase())) return false;
  if (['1', 'true', 'yes'].includes(v.toLowerCase())) return true;
  return v;
}

export interface Config {
  port: number;
  host: string;
  /** Reverse proxy in front of the server, whose X-Forwarded-For/-Proto to believe. */
  trustProxy: boolean | string;
  /** Sites allowed to show the app in a frame (HEARTHBOARD_EMBED_ORIGINS). */
  embedOrigins: string[];
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
    trustProxy: trustProxy(env.HEARTHBOARD_TRUST_PROXY),
    embedOrigins: embedOrigins(env.HEARTHBOARD_EMBED_ORIGINS),
    dataDir,
    photosDir: path.resolve(env.HEARTHBOARD_PHOTOS ?? '/photos'),
    webDir: path.resolve(env.HEARTHBOARD_WEB ?? path.join(import.meta.dirname, '../../web/dist')),
    demo: ['1', 'true', 'yes'].includes((env.HEARTHBOARD_DEMO ?? '').toLowerCase()),
    // HEARTHBOARD_PIN is the older name, from before individual sign-ins.
    adminPassword: env.HEARTHBOARD_ADMIN_PASSWORD || env.HEARTHBOARD_PIN || null,
    resetAdmin: ['1', 'true', 'yes'].includes((env.HEARTHBOARD_RESET_ADMIN ?? '').toLowerCase()),
    secret: env.HEARTHBOARD_SECRET || null,
    timeZone: env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    syncIntervalSec: Math.max(15, num(env, 'HEARTHBOARD_SYNC_INTERVAL', 60)),
    publicUrl: env.HEARTHBOARD_PUBLIC_URL?.replace(/\/+$/, '') || null,
  };
}
