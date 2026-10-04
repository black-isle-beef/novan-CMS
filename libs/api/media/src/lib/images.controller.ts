import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ZodValidationPipe } from '@novan/api-common';
import { imageTransformSchema } from '@novan/shared-schemas';
import type { Response } from 'express';
import { z } from 'zod';
import { ImagesService } from './images.service';

const idPipe = new ZodValidationPipe(z.uuid('Expected an id (UUID).'));

/**
 * Published files for client sites, cached by the CDN: `GET /v1/assets/:id/:filename?width=&height=&resize=&quality=&v=`.
 * No token: only files used by published content are served (see {@link ImagesService}).
 */
@Controller('v1/assets')
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  @Get(':id/:filename')
  async serve(
    @Param('id', idPipe) id: string,
    @Param('filename') filename: string,
    @Query(new ZodValidationPipe(imageTransformSchema)) query: z.output<typeof imageTransformSchema>,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.images.serve(id, filename, query);
    res.set(file.headers).send(file.bytes);
  }
}
