import { Body, Controller, Delete, Get, HttpCode, Param, Put, Query, Res, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthUser, CurrentSpace, CurrentUser, RequireRole, type SpaceAccess, SpaceGuard } from '@novan/api-auth';
import { ApiResponse, csvFilename, ZodValidationPipe } from '@novan/api-common';
import {
  formExportQuerySchema,
  type FormSettings,
  formSettingsSchema,
  type FormSubmission,
  formSubmissionSchema,
  type FormSubmissionsPage,
  formSubmissionsPageSchema,
  formSubmissionsQuerySchema,
  type FormSummary,
  formSummarySchema,
  updateFormSettingsRequestSchema,
} from '@novan/shared-schemas';
import type { Response } from 'express';
import { z } from 'zod';
import { FormsService } from './forms.service';

const idPipe = new ZodValidationPipe(z.uuid('Expected an id (UUID).'));

/**
 * The Forms inbox (docs/build/18-search-forms-audit.md): what visitors sent through the space's forms, for admins and
 * editors (and agency staff), who may also delete and export it. Form settings (who is emailed, how long submissions
 * are kept) are changed by admins. RLS (0020) applies the same rules.
 */
@Controller('v1/management/spaces/:spaceId/forms')
@UseGuards(AuthGuard, SpaceGuard)
@RequireRole('admin', 'editor')
export class FormsController {
  constructor(private readonly forms: FormsService) {}

  /** Forms that have received submissions, most recent first. */
  @Get()
  @ApiResponse(z.array(formSummarySchema))
  list(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess): Promise<FormSummary[]> {
    return this.forms.forms(user, space.id);
  }

  /** Submissions, newest first, a page at a time; `form` for one form's. */
  @Get('submissions')
  @ApiResponse(formSubmissionsPageSchema)
  submissions(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Query(new ZodValidationPipe(formSubmissionsQuerySchema)) query: z.output<typeof formSubmissionsQuerySchema>,
  ): Promise<FormSubmissionsPage> {
    return this.forms.list(user, space.id, query);
  }

  /** One form's submissions as a CSV file (`?form=<its block id>`). */
  @Get('submissions/export')
  @ApiResponse(null)
  async export(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Query(new ZodValidationPipe(formExportQuerySchema)) query: z.output<typeof formExportQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const { csv, name } = await this.forms.exportCsv(user, space.id, query.form);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${csvFilename(name, 'submissions')}"`);
    res.setHeader('Cache-Control', 'no-store');
    return csv;
  }

  @Get('submissions/:id')
  @ApiResponse(formSubmissionSchema)
  get(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess, @Param('id', idPipe) id: string): Promise<FormSubmission> {
    return this.forms.get(user, space.id, id);
  }

  @Delete('submissions/:id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess, @Param('id', idPipe) id: string): Promise<void> {
    return this.forms.remove(user, space.id, id);
  }

  /** Who is emailed about each submission, and how long submissions are kept. */
  @Get('settings')
  @ApiResponse(formSettingsSchema)
  settings(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess): Promise<FormSettings> {
    return this.forms.settings(user, space.id);
  }

  @Put('settings')
  @RequireRole('admin')
  @ApiResponse(formSettingsSchema)
  updateSettings(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Body(new ZodValidationPipe(updateFormSettingsRequestSchema)) body: z.output<typeof updateFormSettingsRequestSchema>,
  ): Promise<FormSettings> {
    return this.forms.updateSettings(user, space.id, body);
  }
}
