import { badRequest, conflict, forbidden } from '@novan/api-common';
import { isCheckViolation, isForeignKeyViolation, isInsufficientPrivilege, isUniqueViolation } from '@novan/api-db';

/** Maps database errors to problems; anything else (including problems already thrown) passes through. */
export function contentProblem(error: unknown): unknown {
  if (isUniqueViolation(error, 'entries_address_idx')) {
    return conflict('slug_taken', 'Another page in this folder already uses this slug. Choose a different one.');
  }
  if (isUniqueViolation(error, 'published_content_address_idx')) {
    return conflict('path_taken', 'Another published page already has this address. Change the slug or folder first.');
  }
  if (isUniqueViolation(error, 'folders_environment_id_path_key')) {
    return conflict('folder_path_taken', 'There is already a folder with this slug here.');
  }
  // Raised by the folder path trigger.
  if (isCheckViolation(error) && String((error as { cause?: Error }).cause?.message ?? error).includes('inside itself')) {
    return badRequest('folder_cycle', 'A folder cannot move inside itself.');
  }
  if (isForeignKeyViolation(error)) return badRequest('folder_not_found', 'That folder does not exist here.');
  if (isInsufficientPrivilege(error)) {
    return forbidden('insufficient_role', 'Your role cannot do this. Publishing and the bin need an editor.');
  }
  return error;
}
