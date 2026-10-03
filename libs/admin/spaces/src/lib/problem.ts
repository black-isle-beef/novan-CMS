import { HttpErrorResponse } from '@angular/common/http';

interface Problem {
  code?: string;
  title?: string;
  detail?: string;
  errors?: Record<string, string[]>;
}

function problemOf(error: unknown): Problem | null {
  return error instanceof HttpErrorResponse && typeof error.error === 'object' && error.error !== null
    ? (error.error as Problem)
    : null;
}

/** Plain-language message for a failed API call (RFC 9457 problem details). */
export function problemMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 0) {
    return 'We could not reach Novan CMS. Check your connection and try again.';
  }
  const problem = problemOf(error);
  return problem?.detail ?? problem?.title ?? 'Something went wrong. Please try again.';
}

/** The stable problem `code`, for branching on specific failures. */
export function problemCode(error: unknown): string | undefined {
  return problemOf(error)?.code;
}

/** Field-level validation messages from a `validation_failed` problem. */
export function problemFieldErrors(error: unknown): Record<string, string[]> {
  return problemOf(error)?.errors ?? {};
}
