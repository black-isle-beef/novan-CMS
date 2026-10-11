import { Module } from '@nestjs/common';
import { AuthModule } from '@novan/api-auth';
import { PostgresSearchProvider } from './postgres-search.provider';
import { SearchController } from './search.controller';
import { SearchProvider } from './search-provider';

/**
 * Search (docs/build/18-search-forms-audit.md): the {@link SearchProvider} the Delivery and Preview APIs use for `q`,
 * and the admin's global search route. Postgres full text for now; provide another `SearchProvider` here to change it.
 */
@Module({
  imports: [AuthModule],
  controllers: [SearchController],
  providers: [{ provide: SearchProvider, useClass: PostgresSearchProvider }],
  exports: [SearchProvider],
})
export class SearchModule {}
