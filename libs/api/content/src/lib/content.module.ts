import { Module } from '@nestjs/common';
import { AuthModule } from '@novan/api-auth';
import { ContentEvents } from './content-events';
import { EntriesController } from './entries.controller';
import { EntriesService } from './entries.service';
import { FoldersController } from './folders.controller';
import { FoldersService } from './folders.service';
import { VersionsController } from './versions.controller';

@Module({
  imports: [AuthModule],
  controllers: [EntriesController, VersionsController, FoldersController],
  providers: [EntriesService, FoldersService, ContentEvents],
  exports: [ContentEvents],
})
export class ContentModule {}
