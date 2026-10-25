import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { auditEvents, DbService, designSystemClasses, designSystems, designSystemVersions } from '@novan/api-db';
import { type Job, JobHandlers } from '@novan/api-jobs';
import { classGroupOf, cssOnlyManifest, type DesignSystemFramework } from '@novan/shared-design-system';
import type { ValidationIssue, ValidationReport } from '@novan/shared-schemas';
import { and, eq } from 'drizzle-orm';
import { processStylesheet } from './css-processor';
import { DesignSystemStorage, filePath, pendingPath, versionPrefix } from './design-system-storage';
import { DESIGN_SYSTEMS_CONFIG, type DesignSystemsConfig } from './design-systems-config';
import type { ProcessVersionJob } from './design-systems.service';
import { FetchProblem, safeFetch } from './safe-fetch';

const CLASS_BATCH = 1000;

/** Why an upload cannot become a version, for its report. */
class UploadProblem extends Error {}

/**
 * The upload worker (`design-systems:process-version`): checks a version's stylesheet, makes it safe to serve and
 * stores it, indexes its classes, and marks the version ready or invalid with what it found. Through the service
 * role, always for the job's space. Idempotent: a version that is no longer `validating` is left alone, and a
 * retried job writes the same files and class index again.
 */
@Injectable()
export class DesignSystemProcessor implements OnModuleInit {
  private readonly logger = new Logger(DesignSystemProcessor.name);

  constructor(
    private readonly db: DbService,
    private readonly storage: DesignSystemStorage,
    private readonly jobs: JobHandlers,
    @Inject(DESIGN_SYSTEMS_CONFIG) private readonly config: DesignSystemsConfig,
  ) {}

  onModuleInit(): void {
    this.jobs.register('design-systems', 'process-version', (job) => this.process(job));
  }

  async process(job: Job): Promise<void> {
    const { spaceId, versionId } = job as ProcessVersionJob;
    if (typeof spaceId !== 'string' || typeof versionId !== 'string') return;
    const [row] = await this.db.serviceDb
      .select({ version: designSystemVersions, system: designSystems })
      .from(designSystemVersions)
      .innerJoin(designSystems, eq(designSystems.id, designSystemVersions.designSystemId))
      .where(and(eq(designSystemVersions.id, versionId), eq(designSystemVersions.spaceId, spaceId)));
    if (!row || row.version.status !== 'validating') return;
    const { version, system } = row;
    const prefix = versionPrefix(spaceId, system.id, version.id);
    const filename = version.filename ?? filenameOf(version.sourceUrl);

    let source: { bytes: Buffer; baseUrl: string | null };
    try {
      source = await this.source(version, prefix, filename);
    } catch (error) {
      if (!(error instanceof UploadProblem || error instanceof FetchProblem)) throw error;
      return this.finish(spaceId, version.id, null, { errors: [{ message: error.message }], warnings: [] }, null);
    }

    const checksum = createHash('sha256').update(source.bytes).digest('hex');
    const text = source.bytes.toString('utf8');
    if (text.includes('\u0000')) {
      return this.finish(spaceId, version.id, null, { errors: [{ file: filename, message: 'The file is not a stylesheet.' }], warnings: [] }, checksum);
    }
    const processed = processStylesheet(text, { file: filename, allowedOrigins: [], baseUrl: source.baseUrl });
    const report: ValidationReport = { errors: processed.errors, warnings: processed.warnings, classes: processed.classes.length };
    if (processed.errors.length) return this.finish(spaceId, version.id, null, report, checksum);

    await this.storage.write(filePath(prefix, filename), Buffer.from(processed.css, 'utf8'), 'text/css; charset=utf-8');
    const manifest = cssOnlyManifest({
      name: system.name,
      version: version.version,
      framework: system.framework as DesignSystemFramework,
      css: filename,
    });
    await this.finish(spaceId, version.id, { manifest, filename, classes: processed.classes }, report, checksum);
    if (version.source === 'css') await this.storage.remove([pendingPath(prefix, filename)]);
  }

  private async source(
    version: typeof designSystemVersions.$inferSelect,
    prefix: string,
    filename: string,
  ): Promise<{ bytes: Buffer; baseUrl: string | null }> {
    if (version.source === 'url' && version.sourceUrl) {
      const fetched = await safeFetch(version.sourceUrl, { maxBytes: this.config.maxFileBytes });
      return { bytes: fetched.bytes, baseUrl: fetched.url };
    }
    if (version.source !== 'css') throw new UploadProblem('Zip packages are not supported yet.');
    const file = await this.storage.read(pendingPath(prefix, filename));
    if (!file) throw new UploadProblem('The upload did not arrive. Upload the stylesheet again as a new version.');
    if (file.bytes.length > this.config.maxFileBytes) {
      throw new UploadProblem(`The stylesheet is bigger than ${Math.round(this.config.maxFileBytes / 1024 / 1024)} MB.`);
    }
    return { bytes: file.bytes, baseUrl: null };
  }

  /** Writes the outcome in one transaction: the class index, the version's status and report, and an audit event. */
  private async finish(
    spaceId: string,
    versionId: string,
    ready: { manifest: object; filename: string; classes: string[] } | null,
    report: ValidationReport,
    checksum: string | null,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(designSystemClasses).where(eq(designSystemClasses.versionId, versionId));
      if (ready) {
        for (let start = 0; start < ready.classes.length; start += CLASS_BATCH) {
          await tx
            .insert(designSystemClasses)
            .values(
              ready.classes.slice(start, start + CLASS_BATCH).map((className) => ({
                versionId,
                spaceId,
                className,
                classGroup: classGroupOf(className),
                sourceFile: ready.filename,
              })),
            )
            .onConflictDoNothing();
        }
      }
      await tx
        .update(designSystemVersions)
        .set({
          status: ready ? 'ready' : 'invalid',
          manifest: ready?.manifest ?? null,
          cssEntry: ready ? [ready.filename] : [],
          validationReport: report,
          checksum,
          processedAt: new Date().toISOString(),
        })
        .where(eq(designSystemVersions.id, versionId));
      await tx.insert(auditEvents).values({
        spaceId,
        actorId: null,
        action: ready ? 'design_system.version_ready' : 'design_system.version_invalid',
        targetType: 'design_system_version',
        targetId: versionId,
        diff: { errors: report.errors.length, warnings: report.warnings.length, classes: report.classes ?? 0 },
      });
    });
    this.logger.log(`Design system version ${versionId} is ${ready ? 'ready' : 'invalid'}: ${describe(report.errors)}`);
  }
}

/** The stylesheet's name from the address it was fetched from, made safe; `styles.css` when there is none. */
export function filenameOf(address: string | null): string {
  const last = address ? decodeURIComponent(new URL(address).pathname.split('/').pop() ?? '') : '';
  const safe = last.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 140);
  if (!safe) return 'styles.css';
  return /\.css$/i.test(safe) ? safe : `${safe}.css`;
}

function describe(errors: ValidationIssue[]): string {
  return errors.length ? errors.map((error) => error.message).join(' ') : 'no errors';
}
