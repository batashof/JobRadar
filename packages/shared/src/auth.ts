import { z } from 'zod';

/**
 * Auth contracts shared between apps/web (client-side form validation) and
 * apps/api (request validation). One source of truth for the shapes.
 */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email').max(320));

/** Deliberately permissive: only length bounds, no composition rules (usability > theatre). */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(200, 'Password must be at most 200 characters');

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  // No length rule on login: match against the stored hash, do not leak policy.
  password: z.string().min(1, 'Password is required'),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

/** Public user shape returned by the API. Never carries the password hash. */
export interface AuthUser {
  id: string;
  email: string;
  digestEnabled: boolean;
}

/** Response of GET /auth/me, POST /auth/login and POST /auth/signup. */
export interface AuthResponse {
  user: AuthUser;
}
