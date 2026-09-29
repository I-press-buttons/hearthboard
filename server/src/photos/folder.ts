import fs from 'node:fs/promises';
import path from 'node:path';

const IMAGE_EXT = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.heic',
  '.heif',
  '.avif',
  '.tif',
  '.tiff',
]);
const HEIF_EXT = new Set(['.heic', '.heif']);
/** Synology metadata (@eaDir), recycle bins (#recycle) and dotfiles. */
const HIDDEN = /^[@#.]/;
const MAX_FILES = 100_000;
const RESCAN_MS = 30 * 60_000;

/** Synology stores pre-rendered thumbnails next to originals: <dir>/@eaDir/<file>/SYNOPHOTO_THUMB_XL.jpg */
export function synologyThumb(abs: string, size: 'XL' | 'M' = 'XL'): string {
  return path.join(path.dirname(abs), '@eaDir', path.basename(abs), `SYNOPHOTO_THUMB_${size}.jpg`);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Photos from a bind-mounted folder, e.g. /volume1/homes/<you>/Photos (Synology
 * Photos personal space) or /volume1/photo (shared space), mounted read-only.
 */
export class FolderSource {
  private scans = new Map<string, { at: number; files: Promise<string[]> }>();

  constructor(readonly root: string) {}

  /** Absolute path for a relative path, refusing anything that escapes the root. */
  resolve(rel: string): string | null {
    const abs = path.resolve(this.root, rel);
    return abs === this.root || abs.startsWith(this.root + path.sep) ? abs : null;
  }

  /**
   * The one spelling of a path under the root (`a/..`, `./a/` and `a` are all "a"), or null
   * if it's outside the root or hidden.
   */
  folderKey(sub: string): string | null {
    const abs = this.resolve(sub);
    if (!abs) return null;
    const rel = path.relative(this.root, abs);
    return rel.split(path.sep).some((s) => HIDDEN.test(s)) ? null : rel;
  }

  async available(): Promise<boolean> {
    try {
      return (await fs.stat(this.root)).isDirectory();
    } catch {
      return false;
    }
  }

  /** Relative paths of every image under `sub` (cached, rescanned every 30 minutes). */
  list(sub = ''): Promise<string[]> {
    const key = this.folderKey(sub);
    if (key === null) return Promise.resolve([]);
    const cur = this.scans.get(key);
    if (cur && Date.now() - cur.at < RESCAN_MS) return cur.files;
    const files = this.scan(path.join(this.root, key));
    this.scans.set(key, { at: Date.now(), files });
    files.catch(() => this.scans.delete(key));
    return files;
  }

  private async scan(dir: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (d: string) => {
      let entries;
      try {
        entries = await fs.readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (out.length >= MAX_FILES) return;
        if (HIDDEN.test(e.name)) continue;
        const abs = path.join(d, e.name);
        if (e.isDirectory()) await walk(abs);
        else if (e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase())) {
          out.push(path.relative(this.root, abs));
        }
      }
    };
    await walk(dir);
    return out.sort();
  }

  /** Top-level sub-folders, for the widget settings picker. */
  async folders(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.root, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory() && !HIDDEN.test(e.name))
        .map((e) => e.name)
        .sort();
    } catch {
      return [];
    }
  }

  /**
   * The file to decode for a photo. HEIC/HEIF originals (iPhone photos) use the
   * JPEG thumbnail Synology already generated, since HEVC decoding isn't bundled.
   */
  async readable(rel: string): Promise<string | null> {
    // Only what a scan would list: a visible image, and not through a symlink out of the root.
    const key = this.folderKey(rel);
    if (!key || !IMAGE_EXT.has(path.extname(key).toLowerCase())) return null;
    const abs = path.join(this.root, key);
    try {
      const [real, realRoot] = await Promise.all([fs.realpath(abs), fs.realpath(this.root)]);
      if (!real.startsWith(realRoot + path.sep)) return null;
    } catch {
      return null;
    }
    if (HEIF_EXT.has(path.extname(abs).toLowerCase())) {
      const thumb = synologyThumb(abs);
      if (await exists(thumb)) return thumb;
      const m = synologyThumb(abs, 'M');
      if (await exists(m)) return m;
    }
    return abs;
  }
}
