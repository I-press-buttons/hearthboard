import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { buildApp, type BuildOptions } from '../src/app';
import { loadConfig, type Config } from '../src/config';

export function tmpDir(prefix = 'hb-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export async function jpeg(file: string, w = 64, h = 48, color = '#c0ffee') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp({ create: { width: w, height: h, channels: 3, background: color } })
    .jpeg()
    .toFile(file);
}

export async function testApp(overrides: Partial<Config> = {}, opts: BuildOptions = {}) {
  const dataDir = tmpDir();
  const config = {
    ...loadConfig({}),
    dataDir,
    photosDir: path.join(dataDir, 'photos'),
    webDir: path.join(dataDir, 'no-web'),
    ...overrides,
  };
  const ctx = await buildApp(config, { background: false, ...opts });
  await ctx.app.ready();
  const client = () => testClient(ctx.app);
  return { ...ctx, config, client, ...client() };
}

export const ADMIN = { username: 'admin', name: 'Admin', password: 'correct horse' };

/** A browser: its own cookie jar, signed in as one user at a time. */
export function testClient(app: FastifyInstance) {
  let cookie = '';
  const inject = async (
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await app.inject({
      method: method as 'GET',
      url,
      payload: body === undefined ? undefined : (body as object),
      headers: { ...(cookie ? { cookie } : {}), ...headers },
    });
    const set = res.headers['set-cookie'];
    if (set) cookie = (Array.isArray(set) ? set[0] : set).split(';')[0];
    return { status: res.statusCode, body: res.body ? safeJson(res.body) : null, raw: res };
  };
  /** Sign in as the admin, creating it on first use. */
  const login = async () => {
    const setup = await inject('POST', '/api/auth/setup', ADMIN);
    if (setup.status !== 200) await signIn(ADMIN.username, ADMIN.password);
  };
  const signIn = (username: string, password: string) =>
    inject('POST', '/api/auth/login', { username, password });
  const logout = () => {
    cookie = '';
  };
  return { inject, login, signIn, logout };
}

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
