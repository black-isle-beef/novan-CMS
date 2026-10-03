import { pgSchema, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * Supabase-managed `auth` schema. Declared by hand (not pulled) because Supabase owns it;
 * only the columns the API needs. `schema.ts` imports `users` for its foreign keys.
 */
export const authSchema = pgSchema('auth');

export const users = authSchema.table('users', {
  id: uuid().primaryKey().notNull(),
  email: varchar({ length: 255 }),
});
