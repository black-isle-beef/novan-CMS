import { Body, Controller, HttpCode, Inject, Injectable, Post, UseGuards } from '@nestjs/common';
import { ZodValidationPipe } from '@novan/api-common';
import { AuthGuard, type AuthUser, CurrentSpace, CurrentUser, RequireAgencyStaff, type SpaceAccess, SpaceGuard } from '@novan/api-auth';
import { DbService, recordAudit } from '@novan/api-db';
import { type GithubSchemaSource, githubSchemaSourceRequestSchema } from '@novan/shared-schemas';
import type { z } from 'zod';
import { type GithubReaderConfig, readGithubSchema } from './github-schema-source';

export const GITHUB_READER_CONFIG = Symbol('GITHUB_READER_CONFIG');

type GithubSchemaSourceBody = z.output<typeof githubSchemaSourceRequestSchema>;

@Injectable()
export class GithubSchemaSourceService {
  constructor(
    private readonly db: DbService,
    @Inject(GITHUB_READER_CONFIG) private readonly config: GithubReaderConfig,
  ) {}

  /** Reads the repo's schema files and records who read which commit for the space. */
  async read(user: AuthUser, spaceId: string, body: GithubSchemaSourceBody): Promise<GithubSchemaSource> {
    const source = await readGithubSchema(body, this.config);
    await this.db.userDb(user.claims, (tx) =>
      recordAudit(tx, {
        spaceId,
        actorId: user.id,
        action: 'schema.github_read',
        targetType: 'schema',
        diff: { repo: source.repo, ref: source.ref, commitSha: source.commitSha, path: source.path },
      }),
    );
    return source;
  }
}

/**
 * Schema files from a GitHub repo, for setting up a new site or restoring one in the admin. Agency staff only: the
 * API's GitHub token can read every agency repo. This only reads; the admin applies the changes through the
 * content-type and block-type routes, as the signed-in person.
 */
@Controller('v1/management/spaces/:spaceId/schema-source/github')
@UseGuards(AuthGuard, SpaceGuard)
@RequireAgencyStaff()
export class GithubSchemaSourceController {
  constructor(private readonly source: GithubSchemaSourceService) {}

  @Post()
  @HttpCode(200)
  read(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Body(new ZodValidationPipe(githubSchemaSourceRequestSchema)) body: GithubSchemaSourceBody,
  ): Promise<GithubSchemaSource> {
    return this.source.read(user, space.id, body);
  }
}
