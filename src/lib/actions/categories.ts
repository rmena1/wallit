'use server'

import { revalidatePath } from 'next/cache'
import { db, categories, type Category } from '@/lib/db'
import { eq, and } from 'drizzle-orm'
import { requireAuth } from '@/lib/auth'
import { generateId } from '@/lib/utils'

export type CategoryActionResult = {
  success: boolean
  error?: string
  categoryId?: string
  category?: Category
}

/**
 * Create a new category
 */
export async function createCategory(formData: FormData): Promise<CategoryActionResult> {
  const session = await requireAuth()
  
  const name = formData.get('name') as string
  const emoji = formData.get('emoji') as string
  
  if (!name || name.trim().length === 0) {
    return { success: false, error: 'Name is required' }
  }
  
  if (!emoji || emoji.trim().length === 0) {
    return { success: false, error: 'Emoji is required' }
  }
  
  const id = generateId()
  const now = new Date()
  const newCategory = {
    id,
    userId: session.id,
    name: name.trim(),
    emoji: emoji.trim(),
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(categories).values(newCategory)
  
  revalidatePath('/')
  revalidatePath('/settings')
  return { success: true, categoryId: id, category: newCategory }
}

/**
 * Update a category's name and/or emoji
 */
export async function updateCategory(formData: FormData): Promise<CategoryActionResult> {
  const session = await requireAuth()
  
  const id = formData.get('id') as string
  const name = formData.get('name') as string
  const emoji = formData.get('emoji') as string
  
  if (!id) {
    return { success: false, error: 'Category ID is required' }
  }
  if (!name || name.trim().length === 0) {
    return { success: false, error: 'Name is required' }
  }
  if (!emoji || emoji.trim().length === 0) {
    return { success: false, error: 'Emoji is required' }
  }
  
  const [updatedCategory] = await db.update(categories).set({
    name: name.trim(),
    emoji: emoji.trim(),
    updatedAt: new Date(),
  }).where(
    and(
      eq(categories.id, id),
      eq(categories.userId, session.id)
    )
  ).returning()
  
  revalidatePath('/')
  revalidatePath('/settings')
  return { success: true, categoryId: id, category: updatedCategory }
}

/**
 * Delete a category
 */
export async function deleteCategory(id: string): Promise<CategoryActionResult> {
  const session = await requireAuth()
  
  await db.delete(categories).where(
    and(
      eq(categories.id, id),
      eq(categories.userId, session.id)
    )
  )
  
  revalidatePath('/')
  revalidatePath('/settings')
  return { success: true }
}

/**
 * Get all categories for the current user
 */
export async function getCategories() {
  const session = await requireAuth()
  
  return db
    .select()
    .from(categories)
    .where(eq(categories.userId, session.id))
    .orderBy(categories.name)
}
