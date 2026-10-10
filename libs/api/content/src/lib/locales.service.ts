import { Inject, Injectable } from '@nestjs/common';
import { badRequest, conflict, forbidden, MACHINE_TRANSLATOR, notFound, type Translator } from '@novan/api-common';
import type { AuthUser } from '@novan/api-auth';
import {
  DbService,
  type DbTransaction,
  isCheckViolation,
  isForeignKeyViolation,
  isInsufficientPrivilege,
  isUniqueViolation,
  readSpaceLocales,
  recordAudit,
  spaceLocales,
  spaces,
} from '@novan/api-db';
import {
  type createLocaleRequestSchema,
  defaultLocalePrefix,
  type ManagedLocales,
  MAX_LOCALES,
  type updateLocaleRequestSchema,
} from '@novan/shared-schemas';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { ContentEvents } from './content-events';

type CreateBody = z.output<typeof createLocaleRequestSchema>;
type UpdateBody = z.output<typeof updateLocaleRequestSchema>;

/**
 * The languages a space publishes in (docs/build/16-localisation.md). Every member reads them; space admins,
 * developers and agency staff change them (RLS agrees, 0013_localisation.sql), and only space admins turn locale
 * prefixes on or off, as other space settings. Every change is audited and purges the space's delivered content.
 */
@Injectable()
export class LocalesService {
  constructor(
    private readonly db: DbService,
    private readonly events: ContentEvents,
    @Inject(MACHINE_TRANSLATOR) private readonly translator: Translator | null,
  ) {}

  list(user: AuthUser, spaceId: string): Promise<ManagedLocales> {
    return this.db.userDb(user.claims, (tx) => this.read(tx, spaceId));
  }

  create(user: AuthUser, spaceId: string, body: CreateBody): Promise<ManagedLocales> {
    return this.change(user, spaceId, async (tx, current) => {
      if (current.locales.length >= MAX_LOCALES) {
        throw conflict('too_many_locales', `A space can have ${MAX_LOCALES} locales at most.`);
      }
      if (current.locales.some((locale) => locale.code === body.code)) {
        throw conflict('locale_exists', `${body.code} is already one of the space's locales.`);
      }
      const prefix = body.prefix ?? defaultLocalePrefix(body.code);
      await tx.insert(spaceLocales).values({ spaceId, code: body.code, name: body.name, fallbackCode: body.fallback ?? null, pathPrefix: prefix });
      return { action: 'locale.added', diff: { code: body.code, name: body.name, fallback: body.fallback ?? null, prefix } };
    });
  }

  update(user: AuthUser, spaceId: string, code: string, body: UpdateBody): Promise<ManagedLocales> {
    return this.change(user, spaceId, async (tx, current) => {
      const locale = current.locales.find((candidate) => candidate.code === code);
      if (!locale) throw notFound('locale_not_found', `${code} is not one of the space's locales.`);
      if (body.fallback && locale.isDefault && !body.isDefault) {
        throw badRequest('default_has_no_fallback', 'The default locale is what every other locale falls back to, so it has no fallback.');
      }
      if (body.isDefault && !locale.isDefault) {
        // The deferred check (0013) wants exactly one default at commit; in between there may be none.
        await tx.update(spaceLocales).set({ isDefault: false }).where(and(eq(spaceLocales.spaceId, spaceId), eq(spaceLocales.isDefault, true)));
      }
      const changes = {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.prefix !== undefined ? { pathPrefix: body.prefix } : {}),
        ...(body.fallback !== undefined ? { fallbackCode: body.fallback } : {}),
        ...(body.isDefault ? { isDefault: true, fallbackCode: null } : {}),
      };
      await tx.update(spaceLocales).set(changes).where(and(eq(spaceLocales.spaceId, spaceId), eq(spaceLocales.code, code)));
      return { action: 'locale.updated', diff: { code, ...body } };
    });
  }

  /** Removing a locale keeps its translations in stored versions until the next save; nothing shows them any more. */
  remove(user: AuthUser, spaceId: string, code: string): Promise<ManagedLocales> {
    return this.change(user, spaceId, async (tx, current) => {
      const locale = current.locales.find((candidate) => candidate.code === code);
      if (!locale) throw notFound('locale_not_found', `${code} is not one of the space's locales.`);
      if (locale.isDefault) throw conflict('default_locale', 'Make another locale the default before removing this one.');
      // Locales that fell back to it fall back to its fallback instead.
      await tx
        .update(spaceLocales)
        .set({ fallbackCode: locale.fallback })
        .where(and(eq(spaceLocales.spaceId, spaceId), eq(spaceLocales.fallbackCode, code)));
      await tx.delete(spaceLocales).where(and(eq(spaceLocales.spaceId, spaceId), eq(spaceLocales.code, code)));
      return { action: 'locale.removed', diff: { code } };
    });
  }

  /** Whether the site serves other locales under their prefix (space admins and agency staff). */
  async setPrefixes(user: AuthUser, spaceId: string, prefixes: boolean): Promise<ManagedLocales> {
    return this.change(user, spaceId, async (tx) => {
      const updated = await tx.update(spaces).set({ localePrefixes: prefixes }).where(eq(spaces.id, spaceId)).returning({ id: spaces.id });
      if (!updated.length) throw forbidden('insufficient_role', 'Only space admins can change how addresses show the locale.');
      return { action: 'space.updated', diff: { localePrefixes: prefixes } };
    });
  }

  private async read(tx: DbTransaction, spaceId: string): Promise<ManagedLocales> {
    return { ...(await readSpaceLocales(tx, spaceId)), machineTranslation: this.translator !== null };
  }

  /** Runs a change and audits it in one transaction, then purges the space's delivered content. */
  private async change(
    user: AuthUser,
    spaceId: string,
    apply: (tx: DbTransaction, current: ManagedLocales) => Promise<{ action: string; diff: Record<string, unknown> }>,
  ): Promise<ManagedLocales> {
    try {
      const result = await this.db.userDb(user.claims, async (tx) => {
        const { action, diff } = await apply(tx, await this.read(tx, spaceId));
        await recordAudit(tx, { spaceId, actorId: user.id, action, targetType: 'space', targetId: spaceId, diff });
        await this.events.emit(tx, { type: 'locales.changed', spaceId, actorId: user.id });
        return this.read(tx, spaceId);
      });
      return result;
    } catch (error) {
      throw localeProblem(error);
    }
  }
}

function localeProblem(error: unknown): unknown {
  if (isUniqueViolation(error, 'space_locales_space_id_path_prefix_key')) {
    return conflict('prefix_taken', 'Another locale already uses this address prefix.');
  }
  if (isForeignKeyViolation(error)) return badRequest('fallback_not_found', 'A locale can only fall back to another of the space\'s locales.');
  if (isCheckViolation(error)) {
    const message = String((error as { cause?: Error }).cause?.message ?? (error as Error)?.message ?? '');
    if (message.includes('circle')) return badRequest('fallback_circle', 'Locales cannot fall back to each other in a circle.');
    return badRequest('invalid_locale', 'A locale cannot fall back to itself, and the default locale falls back to nothing.');
  }
  if (isInsufficientPrivilege(error)) {
    return forbidden('insufficient_role', 'Only space admins and developers can change the space\'s locales.');
  }
  return error;
}
