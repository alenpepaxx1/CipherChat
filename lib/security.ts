import { z } from 'zod';
import DOMPurify from 'dompurify';

// Initialize DOMPurify for browser environment
const purify = typeof window !== 'undefined' ? DOMPurify(window as any) : null;

// Schema for chat messages
export const messageSchema = z.object({
  text: z.string().min(1).max(1000),
  senderId: z.string(),
  isEphemeral: z.boolean().optional(),
});

export const sanitizeInput = (input: string) => {
  if (!purify) return input;
  return purify.sanitize(input);
};

export const validateMessage = (data: unknown) => {
  return messageSchema.safeParse(data);
};
