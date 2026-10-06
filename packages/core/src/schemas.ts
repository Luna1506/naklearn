import { z } from 'zod';

export const GeneratedNoteSchema = z.object({
  kind: z.enum(['qa', 'cloze', 'diagram']),
  front: z.string().min(1),
  back: z.string(),
  slides: z.array(z.number().int()).min(1),
  frontImagePage: z.number().int().nullable(),
  tags: z.array(z.string()),
});

export const ChunkOutputSchema = z.object({
  notes: z.array(GeneratedNoteSchema),
});

export const SynthesisOutputSchema = z.object({
  notes: z.array(GeneratedNoteSchema),
  removeNoteIds: z.array(z.string()),
});

export type GeneratedNote = z.infer<typeof GeneratedNoteSchema>;
export type ChunkOutput = z.infer<typeof ChunkOutputSchema>;
export type SynthesisOutput = z.infer<typeof SynthesisOutputSchema>;
