import { Module } from '@nestjs/common';
import { AuthModule } from '@novan/api-auth';
import { BlockTypesController } from './block-types.controller';
import { ContentModelService } from './content-model.service';
import { ContentTypesController } from './content-types.controller';
import { DbEntrySource, ENTRY_SOURCE } from './entry-source';

@Module({
  imports: [AuthModule],
  controllers: [ContentTypesController, BlockTypesController],
  providers: [ContentModelService, { provide: ENTRY_SOURCE, useClass: DbEntrySource }],
})
export class ContentModelModule {}
