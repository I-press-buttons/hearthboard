import { z } from 'zod';

/** Server-wide settings, changed under Settings → General. */
export interface SystemSettingsDTO {
  /** IANA time zone, e.g. America/Chicago. Decides "today", all-day events and midnight resets. */
  timeZone: string;
  /** Seconds between calendar syncs. */
  syncIntervalSec: number;
  /** HTTPS address of the board, used as the Google sign-in redirect. */
  publicUrl: string | null;
}

export const MIN_SYNC_INTERVAL_SEC = 15;

export const SystemSettingsPatch = z.object({
  timeZone: z.string().min(1).max(100).optional(),
  syncIntervalSec: z.number().int().min(MIN_SYNC_INTERVAL_SEC).max(86_400).optional(),
  publicUrl: z
    .string()
    .trim()
    .max(500)
    .transform((s) => s.replace(/\/+$/, ''))
    .refine((s) => s === '' || /^https?:\/\/[^/\s]+(\/\S*)?$/i.test(s), {
      message: 'Enter an address like https://board.example.synology.me',
    })
    .nullable()
    .optional(),
});
export type SystemSettingsPatch = z.infer<typeof SystemSettingsPatch>;
