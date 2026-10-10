import { Module } from '@nestjs/common';
import { AuthModule } from '@novan/api-auth';
import { createMailer, createTranslator, MACHINE_TRANSLATOR, Mailer, mailerConfigFromEnv } from '@novan/api-common';
import { ContentEvents } from './content-events';
import { EntriesController, ReviewsController } from './entries.controller';
import { EntriesService } from './entries.service';
import { FoldersController } from './folders.controller';
import { FoldersService } from './folders.service';
import { ContentHousekeeping } from './housekeeping';
import { ReleasesController } from './releases.controller';
import { ReleasesService } from './releases.service';
import { ScheduledActionRunner } from './scheduled-actions';
import { LocalesController } from './locales.controller';
import { LocalesService } from './locales.service';
import { VersionsController } from './versions.controller';
import { NOTIFY_CONFIG, notifyConfigFromEnv, WorkflowNotifier } from './workflow-notifier';

@Module({
  imports: [AuthModule],
  controllers: [EntriesController, ReviewsController, VersionsController, FoldersController, LocalesController, ReleasesController],
  providers: [
    EntriesService,
    ReleasesService,
    ScheduledActionRunner,
    ContentHousekeeping,
    FoldersService,
    LocalesService,
    ContentEvents,
    WorkflowNotifier,
    // Workflow emails (docs/build/13-workflow-publishing.md): MAIL_PROVIDER picks the provider; tests replace it.
    { provide: Mailer, useFactory: () => createMailer(mailerConfigFromEnv()) },
    { provide: NOTIFY_CONFIG, useFactory: () => notifyConfigFromEnv() },
    // Machine-translated drafts (docs/build/16-localisation.md): TRANSLATOR picks the provider; none by default.
    { provide: MACHINE_TRANSLATOR, useFactory: () => createTranslator() },
  ],
  exports: [ContentEvents],
})
export class ContentModule {}
