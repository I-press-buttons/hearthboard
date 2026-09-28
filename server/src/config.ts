import path from 'node:path';

function num(name: string, fallback: number): number {
  const v = process.env[name];
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
  /** Seconds between calendar polls. */
  syncIntervalSec: number;
  /** Optional admin PIN set from the environment (otherwise chosen on first visit). */
  adminPin: string | null;
  /** Optional 32+ char secret; otherwise a key file is generated in dataDir. */
  secret: string | null;
  /** Public base URL (e.g. https://board.example.synology.me) used for the Google OAuth callback. */
  publicUrl: string | null;
}

export function loadConfig(env = process.env): Config {
  const dataDir = path.resolve(env.HEARTHBOARD_DATA ?? env.DATA_DIR ?? './data');
  return {
    port: num('PORT', 8080),
    host: env.HOST ?? '0.0.0.0',
    dataDir,
    photosDir: path.resolve(env.HEARTHBOARD_PHOTOS ?? '/photos'),
    webDir: path.resolve(env.HEARTHBOARD_WEB ?? path.join(import.meta.dirname, '../../web/dist')),
    demo: ['1', 'true', 'yes'].includes((env.HEARTHBOARD_DEMO ?? '').toLowerCase()),
    syncIntervalSec: Math.max(15, num('HEARTHBOARD_SYNC_INTERVAL', 60)),
    adminPin: env.HEARTHBOARD_PIN || null,
    secret: env.HEARTHBOARD_SECRET || null,
    publicUrl: env.HEARTHBOARD_PUBLIC_URL?.replace(/\/+$/, '') || null,
  };
}
