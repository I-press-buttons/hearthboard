import { z } from 'zod';

export interface ChecklistItemDTO {
  id: string;
  text: string;
  done: boolean;
  position: number;
}

export interface ChecklistDTO {
  id: string;
  name: string;
  resetDaily: boolean;
  items: ChecklistItemDTO[];
}

export const ChecklistInput = z.object({
  name: z.string().min(1).max(100),
  resetDaily: z.boolean().default(false),
});

export const ChecklistItemInput = z.object({
  text: z.string().min(1).max(500),
});

export const ChecklistItemPatch = z.object({
  text: z.string().min(1).max(500).optional(),
  done: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
});

export interface QuoteDTO {
  kind: 'verse' | 'quote' | 'custom';
  text: string;
  source: string;
}
