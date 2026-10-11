import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthUser, CurrentSpace, CurrentUser, RequireRole, type SpaceAccess, SpaceGuard } from '@novan/api-auth';
import { ApiResponse, csvFilename, ZodValidationPipe } from '@novan/api-common';
import {
  type AuditActor,
  auditActorSchema,
  type AuditContentDiff,
  auditContentDiffSchema,
  auditEventsPageSchema,
  auditEventsQuerySchema,
  type AuditEventsPage,
  auditExportQuerySchema,
} from '@novan/shared-schemas';
import type { Response } from 'express';
import { z } from 'zod';
import { AuditLogService } from './audit-log.service';

const idPipe = new ZodValidationPipe(z.uuid('Expected an id (UUID).'));

/**
 * The audit log (docs/build/18-search-forms-audit.md): who changed what in the space, and when. For space admins and
 * agency staff, as RLS on `audit_events` (0004).
 */
@Controller('v1/management/spaces/:spaceId/audit-events')
@UseGuards(AuthGuard, SpaceGuard)
@RequireRole('admin')
export class AuditLogController {
  constructor(private readonly audit: AuditLogService) {}

  /** Events, newest first, filtered by `actor`, `action` (or a kind of thing, like `entry`) and UK days `from`/`to`. */
  @Get()
  @ApiResponse(auditEventsPageSchema)
  list(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Query(new ZodValidationPipe(auditEventsQuerySchema)) query: z.output<typeof auditEventsQuerySchema>,
  ): Promise<AuditEventsPage> {
    return this.audit.list(user, space.id, query);
  }

  /** People who appear in the log, for the person filter. */
  @Get('actors')
  @ApiResponse(z.array(auditActorSchema))
  actors(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess): Promise<AuditActor[]> {
    return this.audit.actors(user, space.id);
  }

  /** The filtered log as a CSV file. */
  @Get('export')
  @ApiResponse(null)
  async export(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Query(new ZodValidationPipe(auditExportQuerySchema)) query: z.output<typeof auditExportQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const csv = await this.audit.exportCsv(user, space.id, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${csvFilename('audit-log', new Date().toISOString().slice(0, 10))}"`);
    res.setHeader('Cache-Control', 'no-store');
    return csv;
  }

  /** What a publish or restore changed in the page's content (404 `no_content_diff` for other events). */
  @Get(':id/content-diff')
  @ApiResponse(auditContentDiffSchema)
  contentDiff(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess, @Param('id', idPipe) id: string): Promise<AuditContentDiff> {
    return this.audit.contentDiff(user, space.id, id);
  }
}
