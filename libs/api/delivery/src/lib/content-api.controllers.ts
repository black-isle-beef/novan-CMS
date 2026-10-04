import { Controller, Get, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiResponse, ZodValidationPipe } from '@novan/api-common';
import {
  apiIdSchema,
  deliveryEntriesPageSchema,
  deliveryEntriesQuerySchema,
  deliveryEntryQuerySchema,
  deliveryEntrySchema,
  deliveryPageQuerySchema,
  deliverySingletonQuerySchema,
  sitemapQuerySchema,
  sitemapSchema,
} from '@novan/shared-schemas';
import { z } from 'zod';
import type { ApiTokenAccess } from './api-token-resolver';
import { ApiTokenGuard, RequireTokenScope, TokenAccess } from './api-token.guard';
import { CacheHeadersInterceptor } from './cache-headers.interceptor';
import { ContentReader, type Delivered } from './content-reader.service';
import { ApiTokenThrottlerGuard } from './rate-limit';

const idPipe = new ZodValidationPipe(z.uuid('Expected an id (UUID).'));
const apiIdPipe = new ZodValidationPipe(apiIdSchema);

/**
 * The routes client sites read content from. The Delivery and Preview APIs answer the same shapes; the
 * token decides which space and environment, and whether drafts are read.
 */
abstract class ContentApiController {
  constructor(protected readonly reader: ContentReader) {}

  /** One page by its full path (`/` is the top-level `home` page) and locale. */
  @Get('pages')
  @ApiResponse(deliveryEntrySchema)
  page(
    @TokenAccess() access: ApiTokenAccess,
    @Query(new ZodValidationPipe(deliveryPageQuerySchema)) query: z.output<typeof deliveryPageQuerySchema>,
  ): Promise<Delivered<unknown>> {
    return this.reader.page(access, query);
  }

  /** Entries, filtered by `type`, `locale` and `fields.<field>[eq|in|lt|gt]`, sorted, a page at a time. */
  @Get('entries')
  @ApiResponse(deliveryEntriesPageSchema)
  entries(
    @TokenAccess() access: ApiTokenAccess,
    @Query(new ZodValidationPipe(deliveryEntriesQuerySchema)) query: z.output<typeof deliveryEntriesQuerySchema>,
  ): Promise<Delivered<unknown>> {
    return this.reader.entries(access, query);
  }

  @Get('entries/:id')
  @ApiResponse(deliveryEntrySchema)
  entry(
    @TokenAccess() access: ApiTokenAccess,
    @Param('id', idPipe) id: string,
    @Query(new ZodValidationPipe(deliveryEntryQuerySchema)) query: z.output<typeof deliveryEntryQuerySchema>,
  ): Promise<Delivered<unknown>> {
    return this.reader.entry(access, id, query);
  }

  /** A singleton's content, e.g. site settings or navigation. */
  @Get('singletons/:apiId')
  @ApiResponse(deliveryEntrySchema)
  singleton(
    @TokenAccess() access: ApiTokenAccess,
    @Param('apiId', apiIdPipe) apiId: string,
    @Query(new ZodValidationPipe(deliverySingletonQuerySchema)) query: z.output<typeof deliverySingletonQuerySchema>,
  ): Promise<Delivered<unknown>> {
    return this.reader.singleton(access, apiId, query);
  }

  /** Every page's path and when it last changed, for sitemap.xml. */
  @Get('sitemap')
  @ApiResponse(sitemapSchema)
  sitemap(
    @TokenAccess() access: ApiTokenAccess,
    @Query(new ZodValidationPipe(sitemapQuerySchema)) query: z.output<typeof sitemapQuerySchema>,
  ): Promise<Delivered<unknown>> {
    return this.reader.sitemap(access, query);
  }
}

/** Published content for client sites, cached by the CDN and purged on publish. Takes `nv_del_` tokens. */
@Controller('v1/delivery')
@RequireTokenScope('delivery')
@UseGuards(ApiTokenGuard, ApiTokenThrottlerGuard)
@UseInterceptors(CacheHeadersInterceptor)
export class DeliveryController extends ContentApiController {
  // Declared here too: Nest reads constructor parameters from the class it instantiates.
  constructor(reader: ContentReader) {
    super(reader);
  }
}

/** Current drafts, for previews; never cached. Takes `nv_pre_` tokens. */
@Controller('v1/preview')
@RequireTokenScope('preview')
@UseGuards(ApiTokenGuard, ApiTokenThrottlerGuard)
@UseInterceptors(CacheHeadersInterceptor)
export class PreviewController extends ContentApiController {
  constructor(reader: ContentReader) {
    super(reader);
  }
}
