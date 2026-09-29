import { z } from 'zod';
import { DisplayName } from './users';

/**
 * Who may look at a board without signing in. "paired": only screens an admin has paired (and
 * signed-in people). "open": any device on the network, as in earlier versions.
 */
export const DISPLAY_ACCESS = ['paired', 'open'] as const;
export const DisplayAccess = z.enum(DISPLAY_ACCESS);
export type DisplayAccess = z.infer<typeof DisplayAccess>;

/** No I, O, S, Z, 0, 1, 2 or 5: nothing that looks like something else on a TV across the room. */
export const PAIR_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXY346789';
export const PAIR_CODE_LENGTH = 8;

/** What people type is forgiving: any case, with or without the dash or spaces. */
export function normalizePairCode(input: string): string {
  return [...input.toUpperCase()].filter((c) => PAIR_CODE_ALPHABET.includes(c)).join('');
}

/** ABCDEFGH becomes ABCD-EFGH, also while it's being typed. */
export function formatPairCode(code: string): string {
  const c = normalizePairCode(code).slice(0, PAIR_CODE_LENGTH);
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/** What a screen learns about itself (GET /api/displays/me). */
export interface DisplayStatus {
  /** This device may show boards: signed in, paired, or the household allows any device. */
  allowed: boolean;
  access: DisplayAccess;
  /** The name an admin gave this screen, once it's paired. */
  name: string | null;
  /** A code this screen is showing, waiting for an admin to enter it in Settings. */
  pending: { code: string; expiresAt: number } | null;
}

export interface DisplayDTO {
  id: string;
  name: string;
  createdAt: number;
  /** Updated at most once an hour. Null until the screen has used its pairing link. */
  lastSeen: number | null;
  /** Made with a pairing link that hasn't been opened on the screen yet. */
  waiting: boolean;
}

export interface DisplaysDTO {
  access: DisplayAccess;
  displays: DisplayDTO[];
}

/** A new screen made in Settings, with the one-time link to open on it. */
export interface NewDisplayDTO extends DisplayDTO {
  url: string;
  expiresAt: number;
}

export const DisplayInput = z.object({ name: DisplayName });
export const DisplayApprove = z.object({
  code: z.string().trim().min(1).max(30),
  name: DisplayName,
});
export const DisplayAccessInput = z.object({ access: DisplayAccess });
export const DisplayClaim = z.object({ token: z.string().min(1).max(200) });
