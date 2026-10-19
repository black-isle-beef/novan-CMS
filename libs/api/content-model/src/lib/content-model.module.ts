import { Module } from '@nestjs/common';
import { AuthModule } from '@novan/api-auth';
import { BlockTypesController } from './block-types.controller';
import { ContentModelService } from './content-model.service';
import { ContentTypesController } from './content-types.controller';
import { DbEntrySource, ENTRY_SOURCE } from './entry-source';
import { githubReaderConfigFromEnv } from './github-schema-source';
import { GITHUB_READER_CONFIG, GithubSchemaSourceController, GithubSchemaSourceService } from './github-schema-source.controller';

@Module({
  imports: [AuthModule],
  controllers: [ContentTypesController, BlockTypesController, GithubSchemaSourceController],
  providers: [
    ContentModelService,
    { provide: ENTRY_SOURCE, useClass: DbEntrySource },
    GithubSchemaSourceService,
    { provide: GITHUB_READER_CONFIG, useFactory: githubReaderConfigFromEnv },
  ],
})
export class ContentModelModule {}
