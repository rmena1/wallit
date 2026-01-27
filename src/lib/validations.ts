import { z } from 'zod'

// ============================================================================
// AUTH SCHEMAS
// ============================================================================
export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(100, 'Password must be less than 100 characters'),
})

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

// ============================================================================
// MOVEMENT SCHEMAS
// ============================================================================
export const createMovementSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  amount: z.number().int().positive('Amount must be positive'),
  type: z.enum(['income', 'expense']),
})

export const updateMovementSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  amount: z.number().int().positive().optional(),
  type: z.enum(['income', 'expense']).optional(),
})

// ============================================================================
// TYPES
// ============================================================================
export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type CreateMovementInput = z.infer<typeof createMovementSchema>
export type UpdateMovementInput = z.infer<typeof updateMovementSchema>
