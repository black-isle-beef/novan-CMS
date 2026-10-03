import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ZodValidationPipe } from '@novan/api-common';
import { AuthGuard, type AuthUser, CurrentSpace, CurrentUser, type SpaceAccess, SpaceGuard } from '@novan/api-auth';
import type { EntryDiff } from '@novan/shared-schemas';
import { z } from 'zod';
import { EntriesService } from './entries.service';

const idPipe = new ZodValidationPipe(z.uuid('Expected an id (UUID).'));

/** Entry versions by id. */
@Controller('v1/management/spaces/:spaceId/environments/:env/versions')
@UseGuards(AuthGuard, SpaceGuard)
export class VersionsController {
  constructor(private readonly entries: EntriesService) {}

  /** What changed from version `a` to version `b` of the same entry; blocks are matched by `_uid`. */
  @Get(':a/diff/:b')
  diff(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('a', idPipe) a: string,
    @Param('b', idPipe) b: string,
  ): Promise<EntryDiff> {
    return this.entries.diff(user, space.id, env, a, b);
  }
}
