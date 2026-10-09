import { Module } from '@nestjs/common';
import { AuthModule } from '@novan/api-auth';
import { ContentModule } from '@novan/api-content';
import { NotFoundService } from './not-found.service';
import { RedirectsService } from './redirects.service';
import { NotFoundController, RedirectsController } from './site.controllers';

@Module({
  // ContentModule for its event bus: changing redirects purges the CDN (@novan/api-delivery listens).
  imports: [AuthModule, ContentModule],
  controllers: [RedirectsController, NotFoundController],
  providers: [RedirectsService, NotFoundService],
})
export class SiteModule {}