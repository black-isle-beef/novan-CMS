import { Module } from '@nestjs/common';
import { AuthModule } from '@novan/api-auth';
import { createMailer, Mailer, mailerConfigFromEnv } from '@novan/api-common';
import { ContentEvents } from './content-events';
import { EntriesController, ReviewsController } from './entries.controller';
import { EntriesService } from './entries.service';
import { FoldersController } from './folders.controller';
import { FoldersService } from './folders.service';
import { VersionsController } from './versions.controller';
import { NOTIFY_CONFIG, notifyConfigFromEnv, WorkflowNotifier } from './workflow-notifier';

@Module({
  imports: [AuthModule],
  controllers: [EntriesController, ReviewsController, VersionsController, FoldersController],
  providers: [
    EntriesService,
    FoldersService,
    ContentEvents,
    WorkflowNotifier,
    // Workflow emails (docs/build/13-workflow-publishing.md): MAIL_PROVIDER picks the provider; tests replace it.
    { provide: Mailer, useFactory: () => createMailer(mailerConfigFromEnv()) },
    { provide: NOTIFY_CONFIG, useFactory: () => notifyConfigFromEnv() },
  ],
  exports: [ContentEvents],
})
export class ContentModule {}
