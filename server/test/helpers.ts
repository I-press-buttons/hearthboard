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
  /**
   * A wall display an admin has paired, using a pairing link: a browser of its own that holds
   * the display cookie and no sign-in.
   */
  const display = async (name = 'Test TV') => {
    const admin = client();
    await admin.login();
    const made = await admin.inject('POST', '/api/displays', { name });
    const tv = client();
    const token = new URL(made.body.url).hash.replace('#token=', '');
    const claimed = await tv.inject('POST', '/api/displays/claim', { token });
    if (claimed.status !== 200)
      throw new Error(`Could not pair the test display: ${claimed.raw.body}`);
    return tv;
  };
  return { ...ctx, config, client, display, ...client() };
}

export const ADMIN = { username: 'admin', name: 'Admin', password: 'correct horse' };

/** A browser: its own cookie jar, signed in as one user at a time. */
export function testClient(app: FastifyInstance) {
  const jar = new Map<string, string>();
  const inject = async (
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const cookie = cookieHeader();
    const res = await app.inject({
      method: method as 'GET',
      url,
      payload: body === undefined ? undefined : (body as object),
      headers: { ...(cookie ? { cookie } : {}), ...headers },
    });
    for (const line of [res.headers['set-cookie']].flat()) {
      if (!line) continue;
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      // An empty value is the server clearing the cookie.
      if (pair.slice(eq + 1)) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
      else jar.delete(pair.slice(0, eq));
    }
    return { status: res.statusCode, body: res.body ? safeJson(res.body) : null, raw: res };
  };
  /** Sign in as the admin, creating it on first use. */
  const login = async () => {
    const setup = await inject('POST', '/api/auth/setup', ADMIN);
    if (setup.status !== 200) await signIn(ADMIN.username, ADMIN.password);
  };
  const signIn = (username: string, password: string) =>
    inject('POST', '/api/auth/login', { username, password });
  const logout = () => jar.clear();
  /** The Cookie header this browser would send, for requests made some other way. */
  const cookieHeader = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  return { inject, login, signIn, logout, cookieHeader };
}

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
