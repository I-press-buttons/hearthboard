import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateSecret,
  otpauthUri,
  timeStep,
  totpAt,
  verifyTotp,
} from '../src/totp';

// RFC 6238 appendix B, SHA-1 key "12345678901234567890" (last 6 of the 8-digit values).
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));
const RFC_VECTORS: [number, string][] = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
];

describe('totp', () => {
  it('matches the RFC 6238 test vectors', () => {
    for (const [sec, code] of RFC_VECTORS)
      expect(totpAt(RFC_SECRET, timeStep(sec * 1000))).toBe(code);
  });

  it('round-trips base32 (RFC 4648 vectors)', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(base32Decode('mzxw 6ytb oi====').toString()).toBe('foobar');
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
  });

  it('accepts one step of clock drift and refuses replays', () => {
    const secret = generateSecret();
    const now = 1_700_000_000_000;
    const step = timeStep(now);
    expect(verifyTotp(secret, totpAt(secret, step), 0, now)).toBe(step);
    expect(verifyTotp(secret, totpAt(secret, step - 1), 0, now)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, step + 1), 0, now)).toBe(step + 1);
    expect(verifyTotp(secret, totpAt(secret, step - 2), 0, now)).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, step), step, now)).toBeNull();
    expect(verifyTotp(secret, '12345', 0, now)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', 0, now)).toBeNull();
  });

  it('builds an otpauth link authenticator apps understand', () => {
    const uri = new URL(otpauthUri('JBSWY3DPEHPK3PXP', 'sam'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/Hearthboard:sam');
    expect(uri.searchParams.get('secret')).toBe('JBSWY3DPEHPK3PXP');
    expect(uri.searchParams.get('issuer')).toBe('Hearthboard');
  });
});
