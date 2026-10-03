/** Postgres error fields, whether thrown directly by `postgres` or wrapped by Drizzle (`cause`). */
interface PgError {
  code?: string;
  constraint_name?: string;
}

export function pgError(error: unknown): PgError {
  const candidate = (error as { cause?: unknown })?.cause ?? error;
  return typeof candidate === 'object' && candidate !== null ? (candidate as PgError) : {};
}

export const isUniqueViolation = (error: unknown, constraint?: string): boolean => {
  const e = pgError(error);
  return e.code === '23505' && (!constraint || e.constraint_name === constraint);
};

export const isForeignKeyViolation = (error: unknown): boolean => pgError(error).code === '23503';

/** A `check` constraint, or a trigger raising `check_violation`. */
export const isCheckViolation = (error: unknown): boolean => pgError(error).code === '23514';

/** RLS `with check` failure or a missing privilege. */
export const isInsufficientPrivilege = (error: unknown): boolean => pgError(error).code === '42501';
