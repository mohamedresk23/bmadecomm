import { z } from "zod";

export const verifyRequestSchema = z.object({
  userId: z.uuid(),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();
export type VerifyRequestDto = z.infer<typeof verifyRequestSchema>;
export const INVALID_VERIFICATION = "Verification link is invalid or expired.";
