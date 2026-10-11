import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { badRequest, notFound, ProblemException } from '@novan/api-common';
import { blockTypes, DbService, formSubmissions, publishedContent, readSpaceLocales } from '@novan/api-db';
import { enqueue } from '@novan/api-jobs';
import {
  type BlockTypeDef,
  buildFormSubmissionSchema,
  fallbackChain,
  type FieldDef,
  type formSubmitRequestSchema,
  sitePath,
} from '@novan/shared-schemas';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { FORM_BLOCK, findFormBlock, localiseForm } from './form-block';
import type { FormSubmissionJob } from './form-notifier';
import { TurnstileVerifier } from './turnstile';

type SubmitBody = z.output<typeof formSubmitRequestSchema>;

/** Where a submission is sent: the delivery token's space and environment. */
export interface FormTarget {
  spaceId: string;
  environmentId: string;
}

/**
 * Takes what visitors send through `form` blocks (`POST /v1/delivery/forms/:formUid/submit`,
 * docs/build/18-search-forms-audit.md). The form must be on a page published in the token's space and environment; its
 * fields there decide what is accepted, checked on the server whatever the browser did. Robots are kept out by the
 * honeypot field, Cloudflare Turnstile and the route's rate limits. A kept submission and the job that emails the
 * space's recipients are written in one transaction, on the API's own connection (no client role may insert, 0020).
 */
@Injectable()
export class FormSubmissions {
  private readonly logger = new Logger(FormSubmissions.name);

  constructor(
    private readonly db: DbService,
    private readonly turnstile: TurnstileVerifier,
  ) {}

  /** Resolves once the submission is kept (or quietly dropped, when the honeypot was filled in). */
  async submit(target: FormTarget, formUid: string, body: SubmitBody, clientIp: string | null): Promise<void> {
    // A person never sees the honeypot; answering as if all went well tells a robot nothing.
    if (body.website?.trim()) {
      this.logger.log(`Dropped a submission to form ${formUid}: the honeypot was filled in`);
      return;
    }

    const [page] = await this.db.serviceDb
      .select({ data: publishedContent.data, path: publishedContent.fullPath })
      .from(publishedContent)
      .where(
        and(
          eq(publishedContent.entryId, body.entryId),
          eq(publishedContent.spaceId, target.spaceId),
          eq(publishedContent.environmentId, target.environmentId),
        ),
      );
    const node = page ? findFormBlock(page.data, formUid) : null;
    if (!page || !node) throw notFound('form_not_found', 'There is no such form on a published page.');

    const [locales, types] = await Promise.all([
      readSpaceLocales(this.db.serviceDb, target.spaceId),
      this.db.serviceDb
        .select({ apiId: blockTypes.apiId, fields: blockTypes.fields, allowedChildren: blockTypes.allowedChildren })
        .from(blockTypes)
        .where(and(eq(blockTypes.spaceId, target.spaceId), eq(blockTypes.environmentId, target.environmentId))),
    ]);
    const defaultLocale = locales.locales.find((locale) => locale.isDefault)?.code ?? 'en-GB';
    const locale = body.locale ?? defaultLocale;
    if (!locales.locales.some((candidate) => candidate.code === locale)) {
      throw badRequest('locale_not_found', `This site is not published in ${locale}.`);
    }
    // Block type fields are written only by the content model API (validated) or the seed (tested).
    const defs: BlockTypeDef[] = types.map((type) => ({ ...type, fields: type.fields as FieldDef[] }));
    const formType = defs.find((type) => type.apiId === FORM_BLOCK);
    const form = localiseForm(node, formType?.fields ?? [], fallbackChain(locales.locales, locale), defaultLocale, defs);
    if (!form.fields.length) throw notFound('form_not_found', 'This form has no fields to fill in.');

    const parsed = buildFormSubmissionSchema(form.fields).safeParse(body.data);
    if (!parsed.success) {
      const errors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        // Unknown answers are reported under their own names.
        const keys = issue.code === 'unrecognized_keys' ? issue.keys : [issue.path.join('.') || '(form)'];
        for (const key of keys) (errors[key] ??= []).push(issue.code === 'unrecognized_keys' ? 'This form does not ask for this.' : issue.message);
      }
      throw new ProblemException(HttpStatus.BAD_REQUEST, 'form_invalid', 'Invalid form', 'Some answers need attention.', errors);
    }

    // Checked last: a Turnstile response can be checked only once, so a visitor fixing an answer keeps theirs.
    await this.turnstile.verify(body.turnstileToken, clientIp);

    await this.db.transaction(async (tx) => {
      const [saved] = await tx
        .insert(formSubmissions)
        .values({
          spaceId: target.spaceId,
          entryId: body.entryId,
          formUid,
          formName: form.name?.slice(0, 200) ?? null,
          pagePath: sitePath(page.path),
          locale,
          data: parsed.data,
          fields: form.fields.map(({ name, label, type }) => ({ name, label, type })),
        })
        .returning({ id: formSubmissions.id });
      await enqueue(tx, 'notifications', { type: 'form-submission', spaceId: target.spaceId, submissionId: saved.id } satisfies FormSubmissionJob);
    });
  }
}
