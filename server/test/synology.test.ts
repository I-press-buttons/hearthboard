import { describe, expect, it } from 'vitest';
import { SynologyPhotos } from '../src/photos/synology';

function fakeDsm() {
  let sidCounter = 0;
  const valid = new Set<string>();
  const log: string[] = [];
  const f = (async (input: string | URL) => {
    const url = new URL(String(input));
    const q = url.searchParams;
    const api = q.get('api')!;
    log.push(`${api}.${q.get('method')}`);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    if (api === 'SYNO.API.Auth') {
      if (q.get('passwd') !== 'pw') return json({ success: false, error: { code: 400 } });
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
  return { f, log, expireAll: () => valid.clear() };
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
});
