import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * AES-256-GCM box for credentials stored in SQLite (iCloud app passwords, Google
 * refresh tokens, DSM passwords). The key comes from HEARTHBOARD_SECRET or a key
 * file generated once in the data directory.
 */
export class SecretBox {
  private key: Buffer;
  private macKey: Buffer;

  constructor(secret: string) {
    this.key = crypto.createHash('sha256').update(secret).digest();
    this.macKey = Buffer.from(crypto.hkdfSync('sha256', this.key, '', 'hearthboard mac', 32));
  }

  /** A short tag proving the server itself issued `value` (e.g. a photo id). */
  mac(value: string): string {
    return crypto
      .createHmac('sha256', this.macKey)
      .update(value)
      .digest()
      .subarray(0, 16)
      .toString('base64url');
  }

  static fromConfig(secret: string | null, dataDir: string): SecretBox {
    if (secret) return new SecretBox(secret);
    const file = path.join(dataDir, 'secret.key');
    let value: string;
    try {
      value = fs.readFileSync(file, 'utf8').trim();
    } catch {
      fs.mkdirSync(dataDir, { recursive: true });
      value = crypto.randomBytes(32).toString('base64url');
      fs.writeFileSync(file, value + '\n', { mode: 0o600, flag: 'wx' });
    }
    // An empty file would quietly encrypt everything with a key anyone could work out.
    if (!value)
      throw new Error(`${file} is empty. Restore it from a backup, or delete it to start over.`);
    return new SecretBox(value);
  }

  seal(value: unknown): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), data]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  }

  open<T>(sealed: string): T {
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== 'v1') throw new Error('Unknown secret format');
    // Insist on the full 16-byte tag: GCM would otherwise accept a truncated, forgeable one.
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(iv, 'base64url'),
      {
        authTagLength: 16,
      },
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const out = Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]);
    return JSON.parse(out.toString('utf8')) as T;
  }
}
