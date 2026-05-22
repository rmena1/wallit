'use server'

import { revalidatePath } from 'next/cache'
import { db, categories, type Category } from '@/lib/db'
import { eq, and } from 'drizzle-orm'
import { getCurrentSpace } from '@/lib/spaces'
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
  const { user, space } = await getCurrentSpace()
  
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
    spaceId: space.id,
    createdByUserId: user.id,
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
  const { space } = await getCurrentSpace()
  
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
      eq(categories.spaceId, space.id)
    )
  ).returning()

  if (!updatedCategory) {
    return { success: false, error: 'Category not found' }
  }
  
  revalidatePath('/')
  revalidatePath('/settings')
  return { success: true, categoryId: id, category: updatedCategory }
}

/**
 * Delete a category
 */
export async function deleteCategory(id: string): Promise<CategoryActionResult> {
  const { space } = await getCurrentSpace()
  
  const [deletedCategory] = await db.delete(categories).where(
    and(
      eq(categories.id, id),
      eq(categories.spaceId, space.id)
    )
  ).returning({ id: categories.id })

  if (!deletedCategory) {
    return { success: false, error: 'Category not found' }
  }
  
  revalidatePath('/')
  revalidatePath('/settings')
  return { success: true }
}

/**
 * Get all categories for the current Space
 */
export async function getCategories() {
  const { space } = await getCurrentSpace()
  
  return db
    .select()
    .from(categories)
    .where(eq(categories.spaceId, space.id))
    .orderBy(categories.name)
}
