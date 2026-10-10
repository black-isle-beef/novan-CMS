import { Global, Module } from '@nestjs/common';
import { createMailer, Mailer, mailerConfigFromEnv } from '@novan/api-common';
import { JobHandlers } from './job-handlers';
import { JobWorker } from './job-worker';
import { JOBS_CONFIG, jobsConfigFromEnv } from './jobs-config';

/** Background jobs (docs/build/17-scheduling-releases-webhooks.md). Global, so any feature module registers handlers. */
@Global()
@Module({
  providers: [
    JobHandlers,
    JobWorker,
    { provide: JOBS_CONFIG, useFactory: () => jobsConfigFromEnv() },
    // Dead-letter alerts: MAIL_PROVIDER picks the provider; tests replace it.
    { provide: Mailer, useFactory: () => createMailer(mailerConfigFromEnv()) },
  ],
  exports: [JobHandlers, JobWorker],
})
export class JobsModule {}
