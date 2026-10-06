import { z } from 'zod';

export const GeneratedNoteSchema = z.object({
  kind: z.enum(['qa', 'cloze', 'diagram']),
  front: z.string().min(1),
  back: z.string(),
  slides: z.array(z.number().int()).min(1),
  frontImagePage: z.number().int().nullable(),
  tags: z.array(z.string()),
});

export const SummaryOutputSchema = z.object({
  summary: z.string().min(1),
});

export const CardsOutputSchema = z.object({
  notes: z.array(GeneratedNoteSchema),
});


export type GeneratedNote = z.infer<typeof GeneratedNoteSchema>;
export type SummaryOutput = z.infer<typeof SummaryOutputSchema>;
export type CardsOutput = z.infer<typeof CardsOutputSchema>;
