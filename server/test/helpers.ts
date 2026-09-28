import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

  let cookie = '';
  const inject = async (
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await ctx.app.inject({
      method: method as 'GET',
      url,
      payload: body === undefined ? undefined : (body as object),
      headers: { ...(cookie ? { cookie } : {}), ...headers },
    });
    const set = res.headers['set-cookie'];
    if (set) cookie = (Array.isArray(set) ? set[0] : set).split(';')[0];
    return { status: res.statusCode, body: res.body ? safeJson(res.body) : null, raw: res };
  };
  const login = async (pin = '1234') => {
    const setup = await inject('POST', '/api/auth/setup', { pin });
    if (setup.status !== 200) await inject('POST', '/api/auth/login', { pin });
  };
  const logout = () => {
    cookie = '';
  };
  return { ...ctx, config, inject, login, logout };
}

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
