import { z } from "zod";

export const registerRequestSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name is too long"),
  email: z.string().trim().toLowerCase().email("Invalid email address").max(255, "Email is too long"),
  phone: z.string().trim().min(1, "Phone is required").max(20, "Phone is too long"),
  password: z.string().refine(value => value.isWellFormed(), "Password must contain valid Unicode")
    .refine(value => [...value].length >= 15 && [...value].length <= 128,
    "Password must contain 15–128 characters"),
}).strict();

export type RegisterRequestDto = z.infer<typeof registerRequestSchema>;
