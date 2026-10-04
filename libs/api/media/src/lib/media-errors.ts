import { badRequest, conflict, forbidden } from '@novan/api-common';
import { isCheckViolation, isInsufficientPrivilege, isUniqueViolation } from '@novan/api-db';

/** Maps database errors to problems; anything else (including problems already thrown) passes through. */
export function mediaProblem(error: unknown): unknown {
  if (isUniqueViolation(error, 'assets_pkey'))
    return conflict('asset_exists', 'This upload has already been added to the library.');
  if (isInsufficientPrivilege(error)) {
    return forbidden('insufficient_role', 'Your role cannot do this. Replacing files and the bin need an editor.');
  }
  if (isCheckViolation(error)) return badRequest('asset_invalid', 'Some of these details are not allowed.');
  return error;
}

/** Runs `work`, turning database errors into problems. */
export async function withMediaProblems<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw mediaProblem(error);
  }
}
