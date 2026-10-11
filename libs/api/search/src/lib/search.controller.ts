import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthUser, CurrentSpace, CurrentUser, type SpaceAccess, SpaceGuard } from '@novan/api-auth';
import { ApiResponse, ZodValidationPipe } from '@novan/api-common';
import { type AdminSearchResults, adminSearchQuerySchema, adminSearchResultsSchema } from '@novan/shared-schemas';
import type { z } from 'zod';
import { SearchProvider } from './search-provider';

/**
 * The admin's global search (Ctrl+K, docs/build/18-search-forms-audit.md): pages, other entries (drafts as last saved)
 * and media of one environment that match every word, the last as the start of a word. Anyone in the space may search;
 * row-level security decides what each person finds.
 */
@Controller('v1/management/spaces/:spaceId/search')
@UseGuards(AuthGuard, SpaceGuard)
export class SearchController {
  constructor(private readonly search: SearchProvider) {}

  @Get()
  @ApiResponse(adminSearchResultsSchema)
  find(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Query(new ZodValidationPipe(adminSearchQuerySchema)) query: z.output<typeof adminSearchQuerySchema>,
  ): Promise<AdminSearchResults> {
    return this.search.searchSpace(user.claims, { spaceId: space.id, environment: query.environment, q: query.q, limit: query.limit });
  }
}
