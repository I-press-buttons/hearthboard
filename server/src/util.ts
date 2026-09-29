import crypto from 'node:crypto';
import { z } from 'zod';

/** YYYY-MM-DD in the server's local time zone (TZ). */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function shortHash(...parts: string[]): string {
  return crypto.createHash('sha1').update(parts.join('\u0000')).digest('hex').slice(0, 16);
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.name === 'TimeoutError')
    return 'The server took too long to answer.';
  return err instanceof Error ? err.message : String(err);
}

/** True for http:// and https:// addresses only (zod's .url() also accepts ftp:, file:, javascript: and more). */
export function isHttpUrl(s: string): boolean {
  try {
    const { protocol } = new URL(s);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

const HTTP_ONLY = 'Enter an address starting with http:// or https://';

/** A server address for a form field: http or https, nothing else. */
export const httpUrl = () => z.string().url().refine(isHttpUrl, HTTP_ONLY);

/** How long one call to an outside server (Google, CalDAV, Synology) may take. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** A fresh timer for one request. Never keep one: it runs out for every later request too. */
export const requestTimeout = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);

/** fetch for libraries that take a fetch function (tsdav): each call gets its own timer. */
export const timedFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: requestTimeout() });

/** Error carrying an HTTP status code, turned into a JSON response by the error handler. */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
