import crypto from 'node:crypto';

/**
 * Time-based one-time passwords (RFC 6238) as used by Google Authenticator, 1Password, Authy,
 * Microsoft Authenticator and the iPhone's built-in Passwords app: HMAC-SHA1, 6 digits, 30 s.
 */
const STEP_SEC = 30;
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('Invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function timeStep(now = Date.now()): number {
  return Math.floor(now / 1000 / STEP_SEC);
}

export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const n = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(n % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * The time step `code` belongs to, allowing one step of clock drift either way, or null.
 * Steps at or before `lastStep` are refused so a code can't be replayed.
 */
export function verifyTotp(
  secret: string,
  code: string,
  lastStep = 0,
  now = Date.now(),
): number | null {
  const given = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(given)) return null;
  const cur = timeStep(now);
  for (const step of [cur - 1, cur, cur + 1]) {
    if (step <= lastStep) continue;
    const expected = totpAt(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given))) return step;
  }
  return null;
}

/** The otpauth:// link an authenticator app reads from the QR code. */
export function otpauthUri(secret: string, account: string, issuer = 'Hearthboard'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SEC),
  });
  return `otpauth://totp/${label}?${params}`;
}
