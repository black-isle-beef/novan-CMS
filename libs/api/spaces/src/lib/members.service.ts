import { Injectable, Logger } from '@nestjs/common';
import { conflict, notFound } from '@novan/api-common';
import { type AuthUser, SupabaseAdmin } from '@novan/api-auth';
import {
  DbService,
  type DbTransaction,
  isForeignKeyViolation,
  isUniqueViolation,
  members,
  profiles,
  recordAudit,
  roles,
  users,
} from '@novan/api-db';
import type { InviteRequest, Member, SpaceRole } from '@novan/shared-schemas';
import { and, asc, count, eq, sql } from 'drizzle-orm';

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    private readonly db: DbService,
    private readonly supabaseAdmin: SupabaseAdmin,
  ) {}

  list(user: AuthUser, spaceId: string): Promise<Member[]> {
    return this.db.userDb(user.claims, (tx) =>
      tx
        .select(memberColumns)
        .from(members)
        .innerJoin(roles, eq(roles.id, members.roleId))
        .leftJoin(profiles, eq(profiles.userId, members.userId))
        .where(eq(members.spaceId, spaceId))
        .orderBy(asc(sql`lower(coalesce(${profiles.displayName}, ''))`), asc(members.createdAt)),
    ) as Promise<Member[]>;
  }

  async add(user: AuthUser, spaceId: string, userId: string, role: SpaceRole): Promise<Member> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const member = await this.insertMember(tx, user, spaceId, userId, role);
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'member.added',
          targetType: 'member',
          targetId: userId,
          diff: { role },
        });
        return member;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'members_pkey'))
        throw conflict('already_member', 'This person is already a member.');
      if (isForeignKeyViolation(error)) throw notFound('user_not_found', 'No such user.');
      throw error;
    }
  }

  async updateRole(user: AuthUser, spaceId: string, userId: string, role: SpaceRole): Promise<Member> {
    return this.db.userDb(user.claims, async (tx) => {
      const current = await this.currentRole(tx, spaceId, userId);
      if (current === 'admin' && role !== 'admin') await this.assertNotLastAdmin(tx, spaceId);

      await tx
        .update(members)
        .set({ roleId: await this.roleId(tx, spaceId, role) })
        .where(and(eq(members.spaceId, spaceId), eq(members.userId, userId)));
      await recordAudit(tx, {
        spaceId,
        actorId: user.id,
        action: 'member.role_changed',
        targetType: 'member',
        targetId: userId,
        diff: { from: current, to: role },
      });
      return this.getMember(tx, spaceId, userId);
    });
  }

  async remove(user: AuthUser, spaceId: string, userId: string): Promise<void> {
    await this.db.userDb(user.claims, async (tx) => {
      const current = await this.currentRole(tx, spaceId, userId);
      if (current === 'admin') await this.assertNotLastAdmin(tx, spaceId);

      await tx.delete(members).where(and(eq(members.spaceId, spaceId), eq(members.userId, userId)));
      await recordAudit(tx, {
        spaceId,
        actorId: user.id,
        action: 'member.removed',
        targetType: 'member',
        targetId: userId,
        diff: { role: current },
      });
    });
  }

  /**
   * Invites by email through Supabase Auth (which sends the invite email), then adds the member.
   * Someone who already has an account is added straight away.
   */
  async invite(user: AuthUser, spaceId: string, body: InviteRequest): Promise<Member> {
    const adminUrl = (process.env['ADMIN_URL'] ?? 'http://localhost:4200').replace(/\/$/, '');
    const { data, error } = await this.supabaseAdmin.auth.inviteUserByEmail(body.email, {
      redirectTo: `${adminUrl}/accept-invite`,
    });

    let userId = data?.user?.id;
    const newUser = !error;
    if (error) {
      if (error.code !== 'email_exists') {
        this.logger.error(`Invite failed: ${error.code ?? ''} ${error.message}`);
        throw error;
      }
      userId = await this.findUserIdByEmail(body.email);
    }
    if (!userId) throw notFound('user_not_found', 'No such user.');

    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const member = await this.insertMember(tx, user, spaceId, userId, body.role);
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'member.invited',
          targetType: 'member',
          targetId: userId,
          diff: { email: body.email, role: body.role, newUser },
        });
        return member;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'members_pkey'))
        throw conflict('already_member', 'This person is already a member.');
      throw error;
    }
  }

  /**
   * Looks up an existing account by email. `auth.users` is not readable by `authenticated`, so this
   * one narrow read uses the service connection; the membership write that follows runs under RLS.
   */
  private async findUserIdByEmail(email: string): Promise<string | undefined> {
    const [row] = await this.db.serviceDb
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
      .limit(1);
    return row?.id;
  }

  private async insertMember(
    tx: DbTransaction,
    actor: AuthUser,
    spaceId: string,
    userId: string,
    role: SpaceRole,
  ): Promise<Member> {
    await tx
      .insert(members)
      .values({ spaceId, userId, roleId: await this.roleId(tx, spaceId, role), invitedBy: actor.id });
    return this.getMember(tx, spaceId, userId);
  }

  private async getMember(tx: DbTransaction, spaceId: string, userId: string): Promise<Member> {
    const [member] = await tx
      .select(memberColumns)
      .from(members)
      .innerJoin(roles, eq(roles.id, members.roleId))
      .leftJoin(profiles, eq(profiles.userId, members.userId))
      .where(and(eq(members.spaceId, spaceId), eq(members.userId, userId)));
    if (!member) throw notFound('member_not_found', 'No such member.');
    return member as Member;
  }

  private async currentRole(tx: DbTransaction, spaceId: string, userId: string): Promise<string> {
    const [row] = await tx
      .select({ key: roles.key })
      .from(members)
      .innerJoin(roles, eq(roles.id, members.roleId))
      .where(and(eq(members.spaceId, spaceId), eq(members.userId, userId)));
    if (!row) throw notFound('member_not_found', 'No such member.');
    return row.key;
  }

  private async roleId(tx: DbTransaction, spaceId: string, role: SpaceRole): Promise<string> {
    const [row] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.spaceId, spaceId), eq(roles.key, role)));
    if (!row) throw notFound('role_not_found', `This space has no ${role} role.`);
    return row.id;
  }

  private async assertNotLastAdmin(tx: DbTransaction, spaceId: string): Promise<void> {
    const [{ admins }] = await tx
      .select({ admins: count() })
      .from(members)
      .innerJoin(roles, eq(roles.id, members.roleId))
      .where(and(eq(members.spaceId, spaceId), eq(roles.key, 'admin')));
    if (admins <= 1) throw conflict('last_admin', 'A space needs at least one admin.');
  }
}

const memberColumns = {
  userId: members.userId,
  displayName: profiles.displayName,
  role: roles.key,
  invitedBy: members.invitedBy,
  createdAt: members.createdAt,
};
