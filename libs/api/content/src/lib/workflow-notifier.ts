import { Inject, Injectable, Logger } from '@nestjs/common';
import { Mailer } from '@novan/api-common';
import { DbService, members, profiles, roles, spaces, users } from '@novan/api-db';
import { and, eq, ne } from 'drizzle-orm';

export const NOTIFY_CONFIG = Symbol('NOTIFY_CONFIG');

export interface NotifyConfig {
  /** The admin's address, for links in emails (`ADMIN_URL`). */
  adminUrl: string;
}

export function notifyConfigFromEnv(env: NodeJS.ProcessEnv = process.env): NotifyConfig {
  return { adminUrl: (env['ADMIN_URL'] || 'http://localhost:4200').replace(/\/+$/, '') };
}

/** The page an email is about. */
export interface NotifiedPage {
  spaceId: string;
  entryId: string;
  title: string;
}

/**
 * Workflow emails (docs/build/13-workflow-publishing.md): a page sent for review (to the space's admins), changes
 * asked for (to whoever sent it) and a reviewed page published (to whoever sent it). Addresses are read with the
 * service role, as members cannot read each other's email. Nothing here throws: a lost email is logged.
 */
@Injectable()
export class WorkflowNotifier {
  private readonly logger = new Logger(WorkflowNotifier.name);

  constructor(
    private readonly db: DbService,
    private readonly mailer: Mailer,
    @Inject(NOTIFY_CONFIG) private readonly config: NotifyConfig,
  ) {}

  async reviewRequested(page: NotifiedPage, requestedBy: string, message: string | null): Promise<void> {
    await this.safely('review requested', async () => {
      const [to, who, space] = await Promise.all([this.admins(page.spaceId, requestedBy), this.name(requestedBy), this.spaceName(page.spaceId)]);
      await this.mailer.send({
        to,
        subject: `Review requested: ${page.title}`,
        text: lines(
          `${who} asked for a review of "${page.title}" in ${space}.`,
          message ? `Their note: ${message}` : null,
          `Review it and publish it, or ask for changes: ${this.link(page)}`,
        ),
      });
    });
  }

  async changesRequested(page: NotifiedPage, requester: string | null, decidedBy: string, comment: string): Promise<void> {
    if (!requester) return;
    await this.safely('changes requested', async () => {
      const [to, who] = await Promise.all([this.email(requester), this.name(decidedBy)]);
      await this.mailer.send({
        to,
        subject: `Changes requested: ${page.title}`,
        text: lines(`${who} asked for changes to "${page.title}" before it is published:`, comment, `Open the page: ${this.link(page)}`),
      });
    });
  }

  async published(page: NotifiedPage, requester: string | null, publishedBy: string, path: string): Promise<void> {
    if (!requester || requester === publishedBy) return;
    await this.safely('published', async () => {
      const [to, who] = await Promise.all([this.email(requester), this.name(publishedBy)]);
      await this.mailer.send({
        to,
        subject: `Published: ${page.title}`,
        text: lines(`${who} approved "${page.title}". It is live at ${path}.`, `Open the page: ${this.link(page)}`),
      });
    });
  }

  private link(page: NotifiedPage): string {
    return `${this.config.adminUrl}/spaces/${page.spaceId}/content/${page.entryId}`;
  }

  /** The space admins' addresses, without the person acting. */
  private async admins(spaceId: string, except: string): Promise<string[]> {
    const rows = await this.db.serviceDb
      .select({ email: users.email })
      .from(members)
      .innerJoin(roles, eq(roles.id, members.roleId))
      .innerJoin(users, eq(users.id, members.userId))
      .where(and(eq(members.spaceId, spaceId), eq(roles.key, 'admin'), ne(members.userId, except)));
    return rows.flatMap((row) => (row.email ? [row.email] : []));
  }

  /** One person's address, as a list of recipients (empty when they have none). */
  private async email(userId: string): Promise<string[]> {
    const rows = await this.db.serviceDb.select({ email: users.email }).from(users).where(eq(users.id, userId));
    return rows.flatMap((row) => (row.email ? [row.email] : []));
  }

  private async name(userId: string): Promise<string> {
    const [row] = await this.db.serviceDb
      .select({ name: profiles.displayName, email: users.email })
      .from(users)
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(eq(users.id, userId));
    return row?.name?.trim() || row?.email || 'Someone';
  }

  private async spaceName(spaceId: string): Promise<string> {
    const [row] = await this.db.serviceDb.select({ name: spaces.name }).from(spaces).where(eq(spaces.id, spaceId));
    return row?.name ?? 'your space';
  }

  private async safely(what: string, send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch (error) {
      this.logger.warn(`Could not send the "${what}" email: ${String(error)}`);
    }
  }
}

function lines(...parts: (string | null)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join('\n\n');
}
