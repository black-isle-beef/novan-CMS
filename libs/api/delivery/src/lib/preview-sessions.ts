import { Controller, Get, Headers, HttpCode, Injectable, Param, Post, Res, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthUser, CurrentSpace, CurrentUser, type SpaceAccess, SpaceGuard } from '@novan/api-auth';
import { ApiResponse, forbidden, notFound, ZodValidationPipe } from '@novan/api-common';
import { DbService, entries, environments } from '@novan/api-db';
import {
  type PreviewSession,
  previewSessionSchema,
  type SignedPreviewToken,
  signedPreviewTokenSchema,
} from '@novan/shared-schemas';
import type { Response } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { ApiTokenAccess } from './api-token-resolver';
import { ApiTokenGuard, RequireTokenScope, TokenAccess } from './api-token.guard';
import { PREVIEW_CACHE_CONTROL } from './cache-headers.interceptor';
import { PreviewSigner } from './preview-signer';
import { ApiTokenThrottlerGuard } from './rate-limit';

const idPipe = new ZodValidationPipe(z.uuid('Expected an id (UUID).'));

/** The header sites send the admin's signed token in (the SDK's `PREVIEW_HEADER`). */
export const PREVIEW_HEADER = 'x-novan-preview';

const iso = (seconds: number): string => new Date(seconds * 1000).toISOString();

@Injectable()
export class PreviewSessions {
  constructor(
    private readonly db: DbService,
    private readonly signer: PreviewSigner,
  ) {}

  /** A token for one entry the caller can read (RLS decides), in the bin or not found answers 404. */
  async issue(user: AuthUser, spaceId: string, env: string, entryId: string): Promise<SignedPreviewToken> {
    const [entry] = await this.db.userDb(user.claims, (tx) =>
      tx
        .select({ environmentId: entries.environmentId })
        .from(entries)
        .innerJoin(environments, eq(environments.id, entries.environmentId))
        .where(and(eq(entries.id, entryId), eq(entries.spaceId, spaceId), eq(environments.name, env), isNull(entries.deletedAt))),
    );
    if (!entry) throw notFound('entry_not_found', 'This page does not exist, or has been deleted.');
    const { token, claims } = this.signer.sign({ spaceId, environmentId: entry.environmentId, entryId });
    return { token, expiresAt: iso(claims.expiresAt) };
  }

  /** What a signed token allows, if it is valid and was issued for the preview token's own space and environment. */
  check(access: ApiTokenAccess, signed: string | undefined): PreviewSession {
    const claims = signed ? this.signer.verify(signed) : null;
    if (!claims || claims.spaceId !== access.spaceId || claims.environmentId !== access.environmentId) {
      throw forbidden('preview_not_allowed', 'This preview link is not valid. Open the preview again from the admin.');
    }
    return { entryId: claims.entryId, expiresAt: iso(claims.expiresAt), adminOrigin: this.signer.adminOrigin };
  }
}

/** Signed preview tokens for the visual editor. Every member who can read a page can preview it. */
@Controller('v1/management/spaces/:spaceId/environments/:env/entries/:id/preview-token')
@UseGuards(AuthGuard, SpaceGuard)
export class PreviewTokensController {
  constructor(private readonly sessions: PreviewSessions) {}

  /** A token that opens the page's drafts on the site for 15 minutes. */
  @Post()
  @HttpCode(201)
  @ApiResponse(signedPreviewTokenSchema, { status: 201 })
  create(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
  ): Promise<SignedPreviewToken> {
    return this.sessions.issue(user, space.id, env, id);
  }
}

/**
 * Lets a site's server exchange the signed token from `?novan_preview=` (sent as `X-Novan-Preview`) for
 * what it allows. Takes `nv_pre_` tokens, and only signed tokens issued for the same space and environment.
 */
@Controller('v1/preview/session')
@RequireTokenScope('preview')
@UseGuards(ApiTokenGuard, ApiTokenThrottlerGuard)
export class PreviewSessionController {
  constructor(private readonly sessions: PreviewSessions) {}

  @Get()
  @ApiResponse(previewSessionSchema)
  session(
    @TokenAccess() access: ApiTokenAccess,
    @Headers(PREVIEW_HEADER) signed: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): PreviewSession {
    const session = this.sessions.check(access, signed);
    res.setHeader('Cache-Control', PREVIEW_CACHE_CONTROL);
    return session;
  }
}
