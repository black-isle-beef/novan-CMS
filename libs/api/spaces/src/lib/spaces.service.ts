import { HttpStatus, Injectable } from '@nestjs/common';
import { conflict, forbidden, ProblemException } from '@novan/api-common';
import type { AuthUser } from '@novan/api-auth';
import {
  DbService,
  type DbTransaction,
  isInsufficientPrivilege,
  isUniqueViolation,
  members,
  organisations,
  recordAudit,
  roles,
  spaces,
} from '@novan/api-db';
import { type CreateSpaceRequest, type SpaceRole, spaceRoleSchema, type SpaceSummary } from '@novan/shared-schemas';
import { and, asc, eq } from 'drizzle-orm';

@Injectable()
export class SpacesService {
  constructor(private readonly db: DbService) {}

  /** Spaces the caller can see under RLS: their memberships, or every space for agency staff. */
  async list(user: AuthUser): Promise<SpaceSummary[]> {
    const rows = await this.db.userDb(user.claims, (tx) =>
      tx
        .select({
          id: spaces.id,
          name: spaces.name,
          slug: spaces.slug,
          organisationId: spaces.organisationId,
          createdAt: spaces.createdAt,
        })
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

        const [space] = await tx.insert(spaces).values({ organisationId, name: body.name, slug: body.slug }).returning({
          id: spaces.id,
          name: spaces.name,
          slug: spaces.slug,
          organisationId: spaces.organisationId,
          createdAt: spaces.createdAt,
        });

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

function roleIn(user: AuthUser, spaceId: string): SpaceRole | null {
  const role = user.spaces.find((s) => s.id === spaceId)?.role;
  const parsed = spaceRoleSchema.safeParse(role);
  return parsed.success ? parsed.data : null;
}
