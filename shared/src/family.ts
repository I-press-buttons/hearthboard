import { z } from 'zod';
import { MEAL_SLOTS } from './widgets';

// ---------------- meal plan ----------------

export interface MealDTO {
  /** YYYY-MM-DD */
  date: string;
  slot: (typeof MEAL_SLOTS)[number];
  text: string;
}

export const MealDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const MealSlotParam = z.enum(MEAL_SLOTS);
/** Empty text clears the meal. */
export const MealInput = z.object({ text: z.string().trim().max(200) });

// ---------------- family notes ----------------

export const NOTE_COLORS = {
  yellow: '#fde68a',
  pink: '#fbcfe8',
  blue: '#bae6fd',
  green: '#bbf7d0',
  purple: '#ddd6fe',
} as const;
export type NoteColor = keyof typeof NOTE_COLORS;
export const NOTE_COLOR_IDS = Object.keys(NOTE_COLORS) as [NoteColor, ...NoteColor[]];

/** Choices for "Take it down after". Hours; null = keep until someone removes it. */
export const NOTE_EXPIRY_CHOICES: [number | null, string][] = [
  [4, '4 hours'],
  [24, 'Tomorrow (24 hours)'],
  [72, '3 days'],
  [168, 'A week'],
  [null, 'Keep it up'],
];

export interface NoteDTO {
  id: string;
  text: string;
  color: NoteColor;
  /** Who posted it (their display name at the time). */
  author: string;
  authorId: string | null;
  createdAt: number;
  /** ms; null = never expires. */
  expiresAt: number | null;
}

export const NoteInput = z.object({
  text: z.string().trim().min(1, 'Write something first').max(280),
  color: z.enum(NOTE_COLOR_IDS).default('yellow'),
  /** Hours until it disappears from the board; null keeps it until removed. */
  expiresInHours: z
    .number()
    .min(0.25)
    .max(24 * 60)
    .nullable()
    .default(24),
});
export type NoteInput = z.infer<typeof NoteInput>;
