import type { HealthResponse } from '@novan/shared-types';
import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string().min(1),
}) satisfies z.ZodType<HealthResponse>;
