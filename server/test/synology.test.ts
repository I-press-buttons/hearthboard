import { describe, expect, it } from 'vitest';
import { SynologyPhotos } from '../src/photos/synology';

/** A pretend DSM. Like the real one it reads its parameters from the URL or a form body. */
function fakeDsm(password = 'pw') {
  let sidCounter = 0;
  const valid = new Set<string>();
  const log: string[] = [];
  const requests: { method: string; url: string; api: string }[] = [];
  const f = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const q = method === 'POST' ? new URLSearchParams(String(init.body)) : url.searchParams;
    const api = q.get('api')!;
    log.push(`${api}.${q.get('method')}`);
    requests.push({ method, url: String(input), api });
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    if (api === 'SYNO.API.Auth') {
      if (q.get('passwd') !== password) return json({ success: false, error: { code: 400 } });
      const sid = `sid${++sidCounter}`;
      valid.add(sid);
      return json({ success: true, data: { sid } });
    }
    if (!valid.has(q.get('_sid') ?? '')) return json({ success: false, error: { code: 119 } });
    if (api === 'SYNO.Foto.Browse.Album')
      return json({ success: true, data: { list: [{ id: 7, name: 'Summer', item_count: 2 }] } });
    if (api === 'SYNO.Foto.Browse.Item') {
      return json({
        success: true,
        data: {
          list: [
            {
              id: 1,
              filename: 'a.jpg',
              type: 'photo',
              time: 1_780_000_000,
              additional: { thumbnail: { unit_id: 11, cache_key: '11_1' } },
            },
            {
              id: 2,
              filename: 'clip.mov',
              type: 'video',
              additional: { thumbnail: { unit_id: 12, cache_key: '12_1' } },
            },
          ],
        },
      });
    }
    if (api === 'SYNO.Foto.Thumbnail')
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
        headers: { 'content-type': 'image/jpeg' },
      });
    return json({ success: false, error: { code: 102 } });
  }) as typeof fetch;
  return { f, log, requests, expireAll: () => valid.clear() };
}

describe('SynologyPhotos', () => {
  it('lists albums and photo items (skipping videos)', async () => {
    const dsm = fakeDsm();
    const c = new SynologyPhotos(
      { url: 'http://nas:5000/', username: 'wall', password: 'pw' },
      dsm.f,
    );
    expect(await c.albums()).toEqual([{ id: '7', name: 'Summer', count: 2 }]);
    expect(await c.items('7')).toEqual([
      { id: 1, filename: 'a.jpg', time: 1_780_000_000, unitId: 11, cacheKey: '11_1' },
    ]);
    expect((await c.thumbnail(11, '11_1')).length).toBe(3);
    expect(dsm.log.filter((l) => l === 'SYNO.API.Auth.login')).toHaveLength(1);
  });

  it('signs in again when the session expires', async () => {
    const dsm = fakeDsm();
    const c = new SynologyPhotos(
      { url: 'http://nas:5000', username: 'wall', password: 'pw' },
      dsm.f,
    );
    await c.albums();
    dsm.expireAll();
    expect(await c.albums()).toHaveLength(1);
    expect(dsm.log.filter((l) => l === 'SYNO.API.Auth.login')).toHaveLength(2);
  });

  it('explains a wrong password', async () => {
    const c = new SynologyPhotos(
      { url: 'http://nas:5000', username: 'wall', password: 'bad' },
      fakeDsm().f,
    );
    await expect(c.albums()).rejects.toThrow(/rejected the username or password/);
  });

  it('keeps the password and session ID out of the URL', async () => {
    const dsm = fakeDsm('s3cret');
    const c = new SynologyPhotos(
      { url: 'http://nas:5000', username: 'wall', password: 's3cret' },
      dsm.f,
    );
    await c.albums();
    await c.items('7');
    await c.thumbnail(11, '11_1');
    dsm.expireAll();
    await c.albums(); // signs in a second time

    expect(dsm.requests.length).toBeGreaterThan(4);
    for (const r of dsm.requests) {
      expect(r.url).not.toContain('s3cret');
      expect(r.url).not.toContain('passwd');
    }
    // Everything except the thumbnail download is a POST with nothing in the URL.
    const posts = dsm.requests.filter((r) => r.method === 'POST');
    expect(posts.map((r) => r.api)).toContain('SYNO.API.Auth');
    for (const r of posts) expect(new URL(r.url).search).toBe('');
    expect(dsm.requests.filter((r) => r.method !== 'POST').map((r) => r.api)).toEqual([
      'SYNO.Foto.Thumbnail',
    ]);
  });

  it('sends passwords with special characters intact', async () => {
    const password = 'p&ss=w0rd+% é#';
    const c = new SynologyPhotos(
      { url: 'https://nas:5001', username: 'wall', password },
      fakeDsm(password).f,
    );
    expect(await c.albums()).toHaveLength(1);
  });
});
