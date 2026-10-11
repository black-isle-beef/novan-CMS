import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Mailer } from '@novan/api-common';
import { DbService, formSettings, formSubmissions, spaces } from '@novan/api-db';
import { type Job, JobHandlers } from '@novan/api-jobs';
import { eq } from 'drizzle-orm';

export const FORMS_CONFIG = Symbol('FORMS_CONFIG');

export interface FormsConfig {
  /** The admin's address, for the inbox link in emails (`ADMIN_URL`). */
  adminUrl: string;
}

export function formsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): FormsConfig {
  return { adminUrl: (env['ADMIN_URL'] || 'http://localhost:4200').replace(/\/+$/, '') };
}

/** The job queued with each kept submission. */
export interface FormSubmissionJob extends Job {
  type: 'form-submission';
  spaceId: string;
  submissionId: string;
}

/**
 * Emails a space's form recipients about each submission (the `notifications` queue, 0020_forms.sql), with the
 * answers and a link to the inbox. A submission deleted before the job runs, or a space with no recipients, sends
 * nothing. Read on the API's own connection, as the worker acts for no one.
 */
@Injectable()
export class FormNotifier implements OnModuleInit {
  private readonly logger = new Logger(FormNotifier.name);

  constructor(
    private readonly db: DbService,
    private readonly jobs: JobHandlers,
    private readonly mailer: Mailer,
    @Inject(FORMS_CONFIG) private readonly config: FormsConfig,
  ) {}

  onModuleInit(): void {
    this.jobs.register('notifications', 'form-submission', (job) => this.notify(String((job as FormSubmissionJob).submissionId)));
  }

  async notify(submissionId: string): Promise<void> {
    const [row] = await this.db.serviceDb
      .select({
        submission: formSubmissions,
        recipients: formSettings.recipients,
        spaceName: spaces.name,
      })
      .from(formSubmissions)
      .innerJoin(spaces, eq(spaces.id, formSubmissions.spaceId))
      .leftJoin(formSettings, eq(formSettings.spaceId, formSubmissions.spaceId))
      .where(eq(formSubmissions.id, submissionId));
    if (!row?.recipients?.length) return;

    const { submission } = row;
    const data = submission.data as Record<string, unknown>;
    const fields = (submission.fields as { name: string; label: string; type: string }[]) ?? [];
    const answers = fields
      .filter((field) => data[field.name] !== undefined)
      .map((field) => `${field.label}\n${answer(data[field.name])}`);
    const form = submission.formName ?? 'A form';
    const link = `${this.config.adminUrl}/spaces/${submission.spaceId}/forms?submission=${submission.id}`;
    await this.mailer.send({
      to: row.recipients,
      subject: `New message from ${form} on ${row.spaceName}`,
      text: [
        `Someone sent "${form}"${submission.pagePath ? ` on ${submission.pagePath}` : ''}.`,
        ...answers,
        `See it in the inbox: ${link}`,
        `You get this email because you are one of the people told about form messages in ${row.spaceName}.`,
      ].join('\n\n'),
    });
    this.logger.log(`Told ${row.recipients.length} recipient(s) about form submission ${submission.id}`);
  }
}

function answer(value: unknown): string {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return String(value);
}
