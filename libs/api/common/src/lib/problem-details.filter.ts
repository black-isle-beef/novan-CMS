import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ProblemDetails, ProblemException } from './problem';

const codeForStatus: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  422: 'unprocessable',
  429: 'too_many_requests',
};

/** Renders every error as RFC 9457 `application/problem+json`; unknown errors become an opaque 500. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const problem = this.toProblem(exception);
    res.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(exception: unknown): ProblemDetails {
    if (exception instanceof ProblemException) return exception.toProblem();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        type: 'about:blank',
        title: exception.message,
        status,
        code: codeForStatus[status] ?? (status >= 500 ? 'internal_error' : 'error'),
      };
    }

    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    return {
      type: 'about:blank',
      title: 'Internal server error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'internal_error',
    };
  }
}
