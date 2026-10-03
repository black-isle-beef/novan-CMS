import { Module } from '@nestjs/common';
import { AuthModule } from '@novan/api-auth';
import { BlockTypesController } from './block-types.controller';
import { ContentModelService } from './content-model.service';
import { ContentTypesController } from './content-types.controller';
import { ENTRY_SOURCE, noEntries } from './entry-source';

@Module({
  imports: [AuthModule],
  controllers: [ContentTypesController, BlockTypesController],
  // Package 06 replaces `noEntries` with a source that reads the entries table.
  providers: [ContentModelService, { provide: ENTRY_SOURCE, useValue: noEntries }],
})
export class ContentModelModule {}
