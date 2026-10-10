import { Module } from '@nestjs/common';
import { AuthModule } from '@novan/api-auth';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { ImagesController } from './images.controller';
import { ImagesService } from './images.service';
import { MediaEvents } from './media-events';
import { MediaHousekeeping } from './media-housekeeping';
import { MediaStorage } from './media-storage';

@Module({
  imports: [AuthModule],
  controllers: [AssetsController, ImagesController],
  providers: [AssetsService, ImagesService, MediaStorage, MediaEvents, MediaHousekeeping],
  exports: [MediaEvents],
})
export class MediaModule {}
