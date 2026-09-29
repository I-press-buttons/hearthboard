import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SecretBox } from '../src/secrets';
import { tmpDir } from './helpers';

describe('SecretBox', () => {
  it('opens what it sealed, and nothing that was tampered with', () => {
    const box = new SecretBox('a long enough test secret');
    const sealed = box.seal({ password: 'abcd-efgh-ijkl-mnop' });
    expect(box.open(sealed)).toEqual({ password: 'abcd-efgh-ijkl-mnop' });
    expect(() => new SecretBox('another secret').open(sealed)).toThrow();

    // A 4-byte tag is only 32 bits to guess: never accept a shortened one.
    const [v, iv, tag, data] = sealed.split('.');
    const short = Buffer.from(tag, 'base64url').subarray(0, 4).toString('base64url');
    expect(() => box.open([v, iv, short, data].join('.'))).toThrow();
  });

  it('makes a key file once, and refuses an empty one', () => {
    const dir = tmpDir();
    const sealed = SecretBox.fromConfig(null, dir).seal('x');
    expect(fs.statSync(path.join(dir, 'secret.key')).mode & 0o777).toBe(0o600);
    expect(SecretBox.fromConfig(null, dir).open(sealed)).toBe('x');

    fs.writeFileSync(path.join(dir, 'secret.key'), '\n');
    expect(() => SecretBox.fromConfig(null, dir)).toThrow(/empty/);
  });
});
