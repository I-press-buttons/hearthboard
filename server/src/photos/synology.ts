import { Agent } from 'undici';

export interface SynologySecret {
  /** e.g. http://192.168.1.10:5000 or https://nas.local:5001 */
  url: string;
  username: string;
  password: string;
  /** Accept self-signed HTTPS certificates. */
  insecure?: boolean;
}

export interface SynoAlbum {
  id: string;
  name: string;
  count: number;
}

export interface SynoItem {
  id: number;
  filename: string;
  time: number | null;
  unitId: number;
  cacheKey: string;
}

type Fetch = typeof fetch;

interface SynoResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: number };
}

/** Session errors that mean "log in again". */
const SESSION_ERRORS = new Set([105, 106, 107, 119]);

/**
 * Minimal client for the Synology Photos Web API (DSM 7). Use a dedicated DSM
 * user without 2-factor sign-in that can read the albums you want on the board.
 */
export class SynologyPhotos {
  private sid: string | null = null;
  private dispatcher: Agent | undefined;

  constructor(
    private secret: SynologySecret,
    private f: Fetch = fetch,
  ) {
    if (secret.insecure) this.dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
  }

  private endpoint(params: Record<string, string>): string {
    const base = this.secret.url.replace(/\/+$/, '');
    return `${base}/webapi/entry.cgi?${new URLSearchParams(params)}`;
  }

  private async raw(params: Record<string, string>): Promise<Response> {
    const init: RequestInit & { dispatcher?: Agent } = {};
    if (this.dispatcher) init.dispatcher = this.dispatcher;
    return this.f(this.endpoint(params), init);
  }

  async login(): Promise<string> {
    const res = await this.raw({
      api: 'SYNO.API.Auth',
      version: '6',
      method: 'login',
      account: this.secret.username,
      passwd: this.secret.password,
      session: 'HearthboardPhotos',
      format: 'sid',
    });
    const body = (await res.json()) as SynoResponse<{ sid: string }>;
    if (!body.success || !body.data?.sid) {
      const code = body.error?.code;
      throw new Error(
        code === 400
          ? 'Synology rejected the username or password.'
          : code === 403 || code === 406
            ? 'This DSM account needs 2-factor sign-in. Use an account without it.'
            : `Synology sign-in failed (error ${code ?? res.status}).`,
      );
    }
    this.sid = body.data.sid;
    return this.sid;
  }

  private async call<T>(params: Record<string, string>, retry = true): Promise<T> {
    const sid = this.sid ?? (await this.login());
    const res = await this.raw({ ...params, _sid: sid });
    const body = (await res.json()) as SynoResponse<T>;
    if (!body.success) {
      if (retry && SESSION_ERRORS.has(body.error?.code ?? 0)) {
        this.sid = null;
        return this.call<T>(params, false);
      }
      throw new Error(`Synology Photos API error ${body.error?.code ?? res.status} (${params.api})`);
    }
    return body.data as T;
  }

  async albums(): Promise<SynoAlbum[]> {
    const out: SynoAlbum[] = [];
    for (let offset = 0; ; offset += 500) {
      const data = await this.call<{ list: { id: number; name: string; item_count: number }[] }>({
        api: 'SYNO.Foto.Browse.Album',
        version: '1',
        method: 'list',
        offset: String(offset),
        limit: '500',
      });
      out.push(...data.list.map((a) => ({ id: String(a.id), name: a.name, count: a.item_count })));
      if (data.list.length < 500) return out;
    }
  }

  async items(albumId: string): Promise<SynoItem[]> {
    const out: SynoItem[] = [];
    for (let offset = 0; offset < 50_000; offset += 500) {
      const data = await this.call<{
        list: {
          id: number;
          filename: string;
          time?: number;
          type?: string;
          additional?: { thumbnail?: { unit_id: number; cache_key: string } };
        }[];
      }>({
        api: 'SYNO.Foto.Browse.Item',
        version: '1',
        method: 'list',
        album_id: albumId,
        offset: String(offset),
        limit: '500',
        additional: '["thumbnail"]',
      });
      for (const i of data.list) {
        if (i.type && i.type !== 'photo' && i.type !== 'live') continue;
        const t = i.additional?.thumbnail;
        if (!t) continue;
        out.push({ id: i.id, filename: i.filename, time: i.time ?? null, unitId: t.unit_id, cacheKey: t.cache_key });
      }
      if (data.list.length < 500) break;
    }
    return out;
  }

  /** The XL thumbnail (longest side ~1280px), already rotated and in JPEG. */
  async thumbnail(unitId: number, cacheKey: string): Promise<Buffer> {
    const fetchIt = async () =>
      this.raw({
        api: 'SYNO.Foto.Thumbnail',
        version: '1',
        method: 'get',
        mode: 'download',
        id: String(unitId),
        type: 'unit',
        size: 'xl',
        cache_key: cacheKey,
        _sid: this.sid ?? (await this.login()),
      });
    let res = await fetchIt();
    if (!(res.headers.get('content-type') ?? '').startsWith('image/')) {
      this.sid = null;
      res = await fetchIt();
    }
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) {
      throw new Error(`Could not load the Synology thumbnail (${res.status})`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
