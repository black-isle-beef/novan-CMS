import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@novan/api-auth';
import { badRequest, conflict, forbidden, notFound } from '@novan/api-common';
import { apiTokens, DbService, type DbTransaction, environments, isInsufficientPrivilege, profiles, recordAudit } from '@novan/api-db';
import type { ApiToken, ApiTokenScope, createApiTokenRequestSchema, CreatedApiToken } from '@novan/shared-schemas';
import { and, desc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { ApiTokenResolver } from './api-token-resolver';
import { CachePurge } from './cache-purge.service';
import { generateToken } from './token-secret';

type CreateBody = z.output<typeof createApiTokenRequestSchema>;

/**
 * A space's API tokens, for admins and developers (and agency staff). Every query runs as the caller
 * under RLS (`0008_api_tokens.sql` applies the same roles). The secret is returned once, on creation; only
 * its hash is stored. Creating and revoking are audited.
 */
@Injectable()
export class ApiTokensService {
  constructor(
    private readonly db: DbService,
    private readonly resolver: ApiTokenResolver,
    private readonly purge: CachePurge,
  ) {}

  list(user: AuthUser, spaceId: string): Promise<ApiToken[]> {
    return this.db.userDb(user.claims, (tx) => selectTokens(tx, spaceId));
  }

  async create(user: AuthUser, spaceId: string, body: CreateBody): Promise<CreatedApiToken> {
    const secret = generateToken(body.scope);
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const [environment] = await tx
          .select({ id: environments.id })
          .from(environments)
          .where(and(eq(environments.spaceId, spaceId), eq(environments.name, body.environment)));
        if (!environment) throw badRequest('environment_not_found', `This space has no "${body.environment}" environment.`);

        const [row] = await tx
          .insert(apiTokens)
          .values({
            spaceId,
            environmentId: environment.id,
            name: body.name,
            scope: body.scope,
            tokenHash: secret.hash,
            tokenHint: secret.hint,
            createdBy: user.id,
          })
          .returning({ id: apiTokens.id });
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'api_token.created',
          targetType: 'api_token',
          targetId: row.id,
          diff: { name: body.name, scope: body.scope, environment: body.environment },
        });
        const [token] = await selectTokens(tx, spaceId, row.id);
        return { ...token, token: secret.token };
      });
    } catch (error) {
      throw tokenProblem(error);
    }
  }

  /** Stops the token working: at once on this API instance, within half a minute on others, and in the CDN (a purge job). */
  async revoke(user: AuthUser, spaceId: string, id: string): Promise<ApiToken> {
    try {
      const token = await this.db.userDb(user.claims, async (tx) => {
        const [current] = await selectTokens(tx, spaceId, id);
        if (!current) throw notFound('api_token_not_found', 'There is no such token in this space.');
        if (current.revokedAt) throw conflict('api_token_revoked', 'This token is already revoked.');

        await tx.update(apiTokens).set({ revokedAt: new Date().toISOString() }).where(eq(apiTokens.id, id));
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'api_token.revoked',
          targetType: 'api_token',
          targetId: id,
          diff: { name: current.name, scope: current.scope, environment: current.environment },
        });
        await this.purge.queueTokenRevoked(tx, spaceId, id);
        const [revoked] = await selectTokens(tx, spaceId, id);
        return revoked;
      });
      this.resolver.forget(id);
      return token;
    } catch (error) {
      throw tokenProblem(error);
    }
  }
}

async function selectTokens(tx: DbTransaction, spaceId: string, id?: string): Promise<ApiToken[]> {
  const rows = await tx
    .select({
      token: apiTokens,
      environment: environments.name,
      createdByName: profiles.displayName,
    })
    .from(apiTokens)
    .innerJoin(environments, eq(environments.id, apiTokens.environmentId))
    .leftJoin(profiles, eq(profiles.userId, apiTokens.createdBy))
    .where(and(eq(apiTokens.spaceId, spaceId), id ? eq(apiTokens.id, id) : undefined))
    .orderBy(desc(apiTokens.createdAt), desc(apiTokens.id));
  return rows.map(({ token, environment, createdByName }) => ({
    id: token.id,
    name: token.name,
    scope: token.scope as ApiTokenScope,
    environment,
    hint: token.tokenHint,
    createdBy: token.createdBy,
    createdByName,
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt,
    revokedAt: token.revokedAt,
  }));
}

function tokenProblem(error: unknown): unknown {
  if (isInsufficientPrivilege(error)) return forbidden('insufficient_role', 'Only admins and developers manage API tokens.');
  return error;
}
