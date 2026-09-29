import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { z } from 'zod';
import type { Auth } from '../auth';
import type { DisplayGuard } from '../displays';
import { getSetting, setSetting, type DB } from '../db';
import type { LiveHub } from '../live';
import type { SecretBox } from '../secrets';
import { errorMessage, HttpError } from '../util';
import { FolderSource } from './folder';
import { SynologyPhotos, type SynologySecret, type SynoItem } from './synology';

export interface PhotoRef {
  id: string;
  caption: string;
}

const SynologyBody = z.object({
  url: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
  insecure: z.boolean().default(false),
});

const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const decode = <T>(s: string): T | null => {
  try {
    return JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
};

/** Round requested sizes up to 256px steps so the disk cache gets reused. */
function bucket(n: unknown, fallback: number): number {
  const v = Math.min(3840, Math.max(64, Number(n) || fallback));
  return Math.ceil(v / 256) * 256;
}

/** Shuffled deck per source so photos don't repeat until all have been shown. */
class Deck<T> {
  private order: T[] = [];
  private seen: T[] | null = null;
  next(all: T[], key: (x: T) => string | number): T | undefined {
    if (!all.length) return undefined;
    // Drop photos that are gone, once per new listing (the cached one is the same array).
    if (all !== this.seen) {
      const keys = new Set(all.map(key));
      this.order = this.order.filter((x) => keys.has(key(x)));
      this.seen = all;
    }
    if (!this.order.length) {
      this.order = [...all];
      for (let i = this.order.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
      }
    }
    return this.order.pop();
  }
}

export class Photos {
  readonly folder: FolderSource;
  private synology: SynologyPhotos | null = null;
  private decks = new Map<string, Deck<unknown>>();
  private albumCache = new Map<string, { at: number; items: Promise<SynoItem[]> }>();
  private cacheDir: string;
  private writes = 0;

  constructor(
    private db: DB,
    private secrets: SecretBox,
    private live: LiveHub,
    photosDir: string,
    dataDir: string,
  ) {
    this.folder = new FolderSource(photosDir);
    this.cacheDir = path.join(dataDir, 'cache', 'photos');
  }

  private synologySecret(): SynologySecret | null {
    const sealed = getSetting<string>(this.db, 'synologyPhotos');
    return sealed ? this.secrets.open<SynologySecret>(sealed) : null;
  }

  private syno(): SynologyPhotos {
    if (!this.synology) {
      const s = this.synologySecret();
      if (!s) throw new HttpError(400, 'Synology Photos is not set up. Add it in Settings.');
      this.synology = new SynologyPhotos(s);
    }
    return this.synology;
  }

  private deck(key: string): Deck<unknown> {
    let d = this.decks.get(key);
    if (!d) {
      if (this.decks.size >= 100) this.decks.clear(); // only ever a few in real use
      this.decks.set(key, (d = new Deck()));
    }
    return d;
  }

  /** Photo ids are signed, so only photos the server handed out can be requested. */
  private sign(id: string): string {
    return `${id}.${this.secrets.mac(id)}`;
  }

  private verify(signed: string): string | null {
    const dot = signed.lastIndexOf('.');
    const id = signed.slice(0, dot);
    const given = Buffer.from(signed.slice(dot + 1));
    const want = Buffer.from(this.secrets.mac(id));
    return dot > 0 && given.length === want.length && crypto.timingSafeEqual(given, want)
      ? id
      : null;
  }

  private albumItems(albumId: string): Promise<SynoItem[]> {
    const cur = this.albumCache.get(albumId);
    if (cur && Date.now() - cur.at < 15 * 60_000) return cur.items;
    const items = this.syno().items(albumId);
    if (this.albumCache.size >= 100) this.albumCache.clear();
    this.albumCache.set(albumId, { at: Date.now(), items });
    items.catch(() => this.albumCache.delete(albumId));
    return items;
  }

  async next(
    source: 'folder' | 'synology',
    folder: string,
    albumId: string,
  ): Promise<PhotoRef | null> {
    if (source === 'synology') {
      if (!albumId) throw new HttpError(400, 'Pick an album in the widget settings.');
      const items = await this.albumItems(albumId);
      const it = this.deck(`s:${albumId}`).next(items, (x) => (x as SynoItem).id) as
        SynoItem | undefined;
      if (!it) return null;
      return {
        id: this.sign('s.' + encode({ u: it.unitId, k: it.cacheKey })),
        caption: it.time
          ? new Date(it.time * 1000).toLocaleDateString(undefined, {
              month: 'long',
              year: 'numeric',
            })
          : '',
      };
    }
    const key = this.folder.folderKey(folder);
    if (key === null) return null;
    const files = await this.folder.list(key);
    const rel = this.deck(`f:${key}`).next(files, (x) => x as string) as string | undefined;
    if (!rel) return null;
    return {
      id: this.sign('f.' + encode(rel)),
      caption: path.basename(path.dirname(rel)) === '.' ? '' : path.basename(path.dirname(rel)),
    };
  }

  /** Resized JPEG for a photo id, from the disk cache when possible. */
  async image(signed: string, w: number, h: number): Promise<Buffer> {
    const id = this.verify(signed);
    if (!id) throw new HttpError(404, 'Photo not found');
    const file = path.join(
      this.cacheDir,
      crypto.createHash('sha1').update(`${id}:${w}x${h}`).digest('hex') + '.jpg',
    );
    try {
      return await fs.readFile(file);
    } catch {
      /* not cached */
    }
    const [kind, payload] = [id.slice(0, 1), id.slice(2)];
    let input: Buffer | string;
    if (kind === 'f') {
      const rel = decode<string>(payload);
      const readable = rel ? await this.folder.readable(rel) : null;
      if (!readable) throw new HttpError(404, 'Photo not found');
      input = readable;
    } else if (kind === 's') {
      const ref = decode<{ u: number; k: string }>(payload);
      if (!ref) throw new HttpError(404, 'Photo not found');
      input = await this.syno().thumbnail(ref.u, ref.k);
    } else throw new HttpError(404, 'Photo not found');

    let out: Buffer;
    try {
      out = await sharp(input, { failOn: 'none' })
        .rotate()
        .resize(w, h, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
    } catch (err) {
      throw new HttpError(415, `Could not decode this photo: ${errorMessage(err)}`);
    }
    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.writeFile(file, out);
    if (++this.writes % 200 === 0) this.prune().catch(() => {}); // e.g. a file already gone
    return out;
  }

  /** Keep the resize cache under ~3000 files. */
  private async prune(max = 3000) {
    const names = await fs.readdir(this.cacheDir);
    if (names.length <= max) return;
    const stats = await Promise.all(
      names.map(async (n) => ({ n, t: (await fs.stat(path.join(this.cacheDir, n))).mtimeMs })),
    );
    stats.sort((a, b) => a.t - b.t);
    for (const s of stats.slice(0, names.length - max))
      await fs.rm(path.join(this.cacheDir, s.n), { force: true });
  }

  register(app: FastifyInstance, auth: Auth, display: DisplayGuard) {
    app.get<{ Querystring: { source?: string; folder?: string; albumId?: string } }>(
      '/api/photos/next',
      { preHandler: display },
      async (req) => {
        const source = req.query.source === 'synology' ? 'synology' : 'folder';
        const photo = await this.next(source, req.query.folder ?? '', req.query.albumId ?? '');
        return photo ?? { id: null, caption: '' };
      },
    );

    app.get<{ Params: { id: string }; Querystring: { w?: string; h?: string } }>(
      '/api/photos/img/:id',
      { preHandler: display },
      async (req, reply) => {
        const buf = await this.image(
          req.params.id,
          bucket(req.query.w, 1280),
          bucket(req.query.h, 1280),
        );
        reply.header('cache-control', 'public, max-age=86400').type('image/jpeg');
        return buf;
      },
    );

    app.get('/api/photos/status', { preHandler: auth.guard }, async () => {
      const s = this.synologySecret();
      return {
        folder: {
          path: this.folder.root,
          available: await this.folder.available(),
          count: (await this.folder.list('').catch(() => [])).length,
        },
        synology: s
          ? { configured: true, url: s.url, username: s.username, insecure: !!s.insecure }
          : { configured: false },
      };
    });

    app.get('/api/photos/folders', { preHandler: auth.guard }, async () => this.folder.folders());

    app.get('/api/photos/albums', { preHandler: auth.guard }, async () => this.syno().albums());

    app.post('/api/photos/synology', { preHandler: auth.adminGuard }, async (req) => {
      const body = SynologyBody.parse(req.body);
      const client = new SynologyPhotos(body);
      const albums = await client.albums().catch((err) => {
        throw new HttpError(400, errorMessage(err));
      });
      setSetting(this.db, 'synologyPhotos', this.secrets.seal(body));
      this.synology = client;
      this.albumCache.clear();
      this.live.publish('photos');
      return { ok: true, albums };
    });

    app.delete('/api/photos/synology', { preHandler: auth.adminGuard }, async () => {
      this.db.prepare("DELETE FROM settings WHERE key = 'synologyPhotos'").run();
      this.synology = null;
      return { ok: true };
    });
  }
}
