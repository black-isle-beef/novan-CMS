import { HttpStatus, Injectable } from '@nestjs/common';
import { conflict, forbidden, notFound, ProblemException } from '@novan/api-common';
import type { AuthUser } from '@novan/api-auth';
import {
  DbService,
  type DbTransaction,
  dismissOnboarding,
  isInsufficientPrivilege,
  isUniqueViolation,
  members,
  organisations,
  recordAudit,
  roles,
  spaces,
} from '@novan/api-db';
import {
  type CreateSpaceRequest,
  type Onboarding,
  type OnboardingResponse,
  onboardingSchema,
  type SpaceRole,
  spaceRoleSchema,
  type SpaceSummary,
  type updateSpaceRequestSchema,
} from '@novan/shared-schemas';
import { and, asc, eq } from 'drizzle-orm';
import type { z } from 'zod';

type UpdateSpaceBody = z.output<typeof updateSpaceRequestSchema>;

/** What a {@link SpaceSummary} is made of, besides the caller's role. */
const summaryColumns = {
  id: spaces.id,
  name: spaces.name,
  slug: spaces.slug,
  organisationId: spaces.organisationId,
  previewUrl: spaces.previewUrl,
  createdAt: spaces.createdAt,
};

@Injectable()
export class SpacesService {
  constructor(private readonly db: DbService) {}

  /** Spaces the caller can see under RLS: their memberships, or every space for agency staff. */
  async list(user: AuthUser): Promise<SpaceSummary[]> {
    const rows = await this.db.userDb(user.claims, (tx) =>
      tx
        .select(summaryColumns)

        .from(spaces)
        .orderBy(asc(spaces.name)),
    );
    return rows.map((row) => ({ ...row, role: roleIn(user, row.id) }));
  }

  /**
   * Creates a space (agency staff only, enforced by RLS too) and makes the creator its admin.
   * The creator's token lists the new space after its next refresh.
   */
  async create(user: AuthUser, body: CreateSpaceRequest): Promise<SpaceSummary> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const organisationId = body.organisationId ?? (await this.defaultOrganisation(tx));

        // New spaces open with the onboarding checklist (0009_onboarding.sql).
        const settings = { onboarding: { completed: {}, dismissedAt: null } satisfies Onboarding };
        const [space] = await tx.insert(spaces).values({ organisationId, name: body.name, slug: body.slug, settings }).returning(summaryColumns);

        // The insert trigger created the default roles.
        const [admin] = await tx
          .select({ id: roles.id })
          .from(roles)
          .where(and(eq(roles.spaceId, space.id), eq(roles.key, 'admin')));
        await tx.insert(members).values({ spaceId: space.id, userId: user.id, roleId: admin.id });

        await recordAudit(tx, {
          spaceId: space.id,
          actorId: user.id,
          action: 'space.created',
          targetType: 'space',
          targetId: space.id,
          diff: { name: space.name, slug: space.slug },
        });
        return { ...space, role: 'admin' as const };
      });
    } catch (error) {
      if (isUniqueViolation(error, 'spaces_slug_key'))
        throw conflict('slug_taken', 'That web address is already used.');
      if (isInsufficientPrivilege(error)) throw forbidden('agency_staff_only', 'Only agency staff can create spaces.');
      throw error;
    }
  }

  /** Renames the space or changes its site address. RLS lets only its admins and agency staff (0004). */
  async update(user: AuthUser, spaceId: string, body: UpdateSpaceBody): Promise<SpaceSummary> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const [before] = await tx.select(summaryColumns).from(spaces).where(eq(spaces.id, spaceId));
        if (!before) throw notFound('space_not_found', 'No such space.');
        const changes = {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.previewUrl !== undefined ? { previewUrl: body.previewUrl } : {}),
        };
        const [space] = await tx.update(spaces).set(changes).where(eq(spaces.id, spaceId)).returning(summaryColumns);
        if (!space) throw forbidden('insufficient_role', 'Only space admins can change the space settings.');
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'space.updated',
          targetType: 'space',
          targetId: spaceId,
          diff: Object.fromEntries(
            Object.entries(changes).map(([key, value]) => [key, { from: before[key as keyof typeof changes], to: value }]),
          ),
        });
        return { ...space, role: roleIn(user, space.id) };
      });
    } catch (error) {
      if (isInsufficientPrivilege(error)) throw forbidden('insufficient_role', 'Only space admins can change the space settings.');
      throw error;
    }
  }

  /** The space's onboarding checklist, or null when it has none. */
  onboarding(user: AuthUser, spaceId: string): Promise<OnboardingResponse> {
    return this.db.userDb(user.claims, (tx) => readOnboarding(tx, spaceId));
  }

  async dismissOnboarding(user: AuthUser, spaceId: string): Promise<OnboardingResponse> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        await dismissOnboarding(tx, spaceId);
        return readOnboarding(tx, spaceId);
      });
    } catch (error) {
      if (isInsufficientPrivilege(error)) throw forbidden('insufficient_role', 'Your role cannot change the checklist.');
      throw error;
    }
  }

  /**
   * Records that agency staff started (`role`) or stopped (`null`) viewing the space as a role. Viewing as is
   * UI only: the admin turns every change off, and the API still answers with the caller's real rights.
   */
  async viewAs(user: AuthUser, spaceId: string, role: SpaceRole | null): Promise<void> {
    await this.db.userDb(user.claims, (tx) =>
      recordAudit(tx, {
        spaceId,
        actorId: user.id,
        action: role ? 'view_as.started' : 'view_as.stopped',
        targetType: 'space',
        targetId: spaceId,
        diff: role ? { role } : undefined,
      }),
    );
  }

  private async defaultOrganisation(tx: DbTransaction): Promise<string> {
    const visible = await tx.select({ id: organisations.id }).from(organisations).limit(2);
    if (visible.length !== 1) {
      throw new ProblemException(
        HttpStatus.BAD_REQUEST,
        'organisation_required',
        'Organisation required',
        'Choose the organisation the space belongs to.',
      );
    }
    return visible[0].id;
  }
}

async function readOnboarding(tx: DbTransaction, spaceId: string): Promise<OnboardingResponse> {
  const [space] = await tx.select({ settings: spaces.settings }).from(spaces).where(eq(spaces.id, spaceId));
  if (!space) throw notFound('space_not_found', 'No such space.');
  const parsed = onboardingSchema.safeParse((space.settings as Record<string, unknown> | null)?.['onboarding']);
  return { checklist: parsed.success ? parsed.data : null };
}

function roleIn(user: AuthUser, spaceId: string): SpaceRole | null {
  const role = user.spaces.find((s) => s.id === spaceId)?.role;
  const parsed = spaceRoleSchema.safeParse(role);
  return parsed.success ? parsed.data : null;
}
