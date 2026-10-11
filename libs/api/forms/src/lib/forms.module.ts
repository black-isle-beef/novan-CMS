import { Module } from '@nestjs/common';
import { AuthModule } from '@novan/api-auth';
import { createMailer, Mailer, mailerConfigFromEnv } from '@novan/api-common';
import { FORMS_CONFIG, FormNotifier, formsConfigFromEnv } from './form-notifier';
import { FormSubmissions } from './form-submissions.service';
import { FormsController } from './forms.controller';
import { FormsHousekeeping } from './forms-housekeeping';
import { FormsService } from './forms.service';
import { TURNSTILE_CONFIG, turnstileConfigFromEnv, TurnstileVerifier } from './turnstile';

/**
 * Forms (docs/build/18-search-forms-audit.md): the inbox's management routes, {@link FormSubmissions} for the Delivery
 * API's submit route, the emails about new submissions and the retention purge.
 */
@Module({
  imports: [AuthModule],
  controllers: [FormsController],
  providers: [
    FormsService,
    FormSubmissions,
    FormNotifier,
    FormsHousekeeping,
    TurnstileVerifier,
    { provide: TURNSTILE_CONFIG, useFactory: () => turnstileConfigFromEnv() },
    { provide: FORMS_CONFIG, useFactory: () => formsConfigFromEnv() },
    // Submission emails: MAIL_PROVIDER picks the provider; tests replace it.
    { provide: Mailer, useFactory: () => createMailer(mailerConfigFromEnv()) },
  ],
  exports: [FormSubmissions],
})
export class FormsModule {}
