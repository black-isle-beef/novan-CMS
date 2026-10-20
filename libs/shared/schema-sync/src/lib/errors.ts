/** A failure to show to the person syncing a schema: the message is shown as-is, without a stack. */
export class SchemaSyncError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = 'SchemaSyncError';
  }
}

/** The detail, with field errors (`fields.0.type: ...`) underneath. */
function problemText(detail: string, body: Record<string, unknown>): string {
  const errors = body['errors'];
  if (!errors || typeof errors !== 'object') return detail;
  const lines = Object.entries(errors as Record<string, string[]>).map(([path, messages]) => `  ${path}: ${messages.join(' ')}`);
  return [detail, ...lines].join('\n');
}

/** An error answer from the Novan API (RFC 9457 problem details, with the API's stable `code`). */
export class ApiError extends SchemaSyncError {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: string,
    readonly body: Record<string, unknown>,
  ) {
    super(problemText(detail, body));
    this.name = 'ApiError';
  }
}
