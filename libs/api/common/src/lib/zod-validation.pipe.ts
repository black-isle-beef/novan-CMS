import { HttpStatus, PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { ProblemException } from './problem';

/** Validates a request body or param with a schema from `@novan/shared-schemas`. Use as `@Body(new ZodValidationPipe(schema))`. */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const errors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join('.') || '(root)';
      (errors[path] ??= []).push(issue.message);
    }
    throw new ProblemException(
      HttpStatus.BAD_REQUEST,
      'validation_failed',
      'Validation failed',
      'The request contains invalid values.',
      errors,
    );
  }
}
