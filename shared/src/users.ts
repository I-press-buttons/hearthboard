import { z } from 'zod';

export const ROLES = ['admin', 'member'] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export const MIN_PASSWORD_LENGTH = 8;

export const Username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{2,32}$/, 'Use 2–32 letters, digits, dots, dashes or underscores');
export const Password = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(200);
export const DisplayName = z.string().trim().min(1, 'Enter a name').max(60);

export interface UserDTO {
  id: string;
  username: string;
  name: string;
  role: Role;
  /** Two-step sign-in (authenticator app) is on. */
  mfa: boolean;
  recoveryCodesLeft: number;
  createdAt: number;
}

/**
 * `stage` is set while a sign-in is half done: "mfa" waits for an authenticator code, "enroll"
 * for the user to set up an authenticator because the household requires one.
 */
export interface AuthStatus {
  setupNeeded: boolean;
  authenticated: boolean;
  stage: 'mfa' | 'enroll' | null;
  user: UserDTO | null;
  requireMfa: boolean;
  /** Upgraded from the single admin PIN: sign in as "admin" with the old PIN. */
  legacyPin: boolean;
}

export const SetupInput = z.object({ username: Username, name: DisplayName, password: Password });

export const LoginInput = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
});

export const CodeInput = z.object({ code: z.string().trim().min(1).max(40) });

export const PasswordConfirm = z.object({ password: z.string().min(1).max(200) });

export const PasswordChange = z.object({
  current: z.string().min(1).max(200),
  password: Password,
});

export const NewUserInput = z.object({
  username: Username,
  name: DisplayName,
  password: Password,
  role: Role.default('member'),
});

export const UserPatch = z.object({
  username: Username.optional(),
  name: DisplayName.optional(),
  role: Role.optional(),
  password: Password.optional(),
  /** Turn off the user's two-step sign-in, e.g. after a lost phone. */
  resetMfa: z.literal(true).optional(),
});

export const SecurityPolicy = z.object({ requireMfa: z.boolean() });

export interface TotpSetup {
  /** Base32 secret, for typing into an app by hand. */
  secret: string;
  uri: string;
  /** SVG markup of the QR code for `uri`. */
  qrSvg: string;
}

export interface BoardSummary {
  id: string;
  name: string;
  ownerId: string | null;
  ownerName: string | null;
}
