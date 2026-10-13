/** A failure to report to the person running the CLI: the message is printed as-is, without a stack. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = 'CliError';
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
export class ApiError extends CliError {
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
