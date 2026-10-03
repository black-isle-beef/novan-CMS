import { HttpException, HttpStatus } from '@nestjs/common';

/** RFC 9457 problem details. `code` is stable and safe for clients to branch on. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  /** Field-level validation errors, keyed by dotted path. */
  errors?: Record<string, string[]>;
  /** Extension members specific to `code`, e.g. `affectedEntries` (RFC 9457 section 3.2). */
  [extension: string]: unknown;
}

/** Throw from services and guards; {@link ProblemDetailsFilter} renders it as `application/problem+json`. */
export class ProblemException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    title: string,
    detail?: string,
    readonly errors?: Record<string, string[]>,
    readonly extensions?: Record<string, unknown>,
  ) {
    super({ title, detail }, status);
  }

  toProblem(): ProblemDetails {
    const { title, detail } = this.getResponse() as { title: string; detail?: string };
    return {
      ...this.extensions,
      type: 'about:blank',
      title,
      status: this.getStatus(),
      code: this.code,
      ...(detail ? { detail } : {}),
      ...(this.errors ? { errors: this.errors } : {}),
    };
  }
}

export const badRequest = (code: string, detail?: string, errors?: Record<string, string[]>): ProblemException =>
  new ProblemException(HttpStatus.BAD_REQUEST, code, 'Bad request', detail, errors);

export const unauthorized = (code: string, detail?: string): ProblemException =>
  new ProblemException(HttpStatus.UNAUTHORIZED, code, 'Unauthorized', detail);

export const forbidden = (code: string, detail?: string): ProblemException =>
  new ProblemException(HttpStatus.FORBIDDEN, code, 'Forbidden', detail);

export const notFound = (code: string, detail?: string): ProblemException =>
  new ProblemException(HttpStatus.NOT_FOUND, code, 'Not found', detail);

export const conflict = (code: string, detail?: string): ProblemException =>
  new ProblemException(HttpStatus.CONFLICT, code, 'Conflict', detail);
