import type { EntryStatus, WorkflowAction, WorkflowState } from '@novan/shared-schemas';

/**
 * The publishing workflow (docs/build/13-workflow-publishing.md), as one pure state machine the API checks
 * every change against and the admin reads its buttons from (`allowedActions`, sent with each entry's workflow).
 * The database applies the same rules again (0011_workflow.sql).
 *
 *   draft ──submit──▶ in_review ──approve──▶ published
 *     ▲  ◀──requestChanges / edit──┘              │
 *     └────────────────── edit / unpublish ◀──────┘
 *   any ──archive──▶ archived ──restore──▶ draft
 *
 * Without approval, editors and up publish a draft directly and nobody submits. With approval, authors, editors and
 * developers submit, and space admins and agency staff approve, ask for changes or publish directly.
 */

/** Who is acting: their role in the space (null for agency staff who are not members) and whether they are agency staff. */
export interface WorkflowActor {
  role: string | null;
  agencyStaff: boolean;
}

/** What the rules need to know about an entry. */
export interface WorkflowEntry {
  state: WorkflowState;
  /** It has a published version on the site (in any state but archived). */
  live: boolean;
  /** The space needs approval to publish. */
  requireApproval: boolean;
}

const AUTHORS = ['admin', 'developer', 'editor', 'author'];
const EDITORS = ['admin', 'developer', 'editor'];
const APPROVERS = ['admin'];

const has = (actor: WorkflowActor, roles: readonly string[]): boolean => actor.agencyStaff || roles.includes(actor.role ?? '');

/** Where each action leads. */
export const WORKFLOW_TRANSITIONS: Readonly<Record<WorkflowAction, { from: readonly WorkflowState[]; to: WorkflowState }>> = {
  // Saving a new version: a published page goes back to draft (its live version stays), a page in review leaves review.
  edit: { from: ['draft', 'in_review', 'published'], to: 'draft' },
  submit: { from: ['draft'], to: 'in_review' },
  approve: { from: ['in_review'], to: 'published' },
  requestChanges: { from: ['in_review'], to: 'draft' },
  // Publishing a published page again refreshes its live copy (and checks it against today's files and model).
  publish: { from: ['draft', 'in_review', 'published'], to: 'published' },
  unpublish: { from: ['draft', 'in_review', 'published'], to: 'draft' },
  archive: { from: ['draft', 'in_review', 'published'], to: 'archived' },
  restore: { from: ['archived'], to: 'draft' },
};

/** Whether `actor` may take `action` on `entry`. */
export function canTake(action: WorkflowAction, entry: WorkflowEntry, actor: WorkflowActor): boolean {
  if (!WORKFLOW_TRANSITIONS[action].from.includes(entry.state)) return false;
  switch (action) {
    case 'edit':
      return has(actor, AUTHORS);
    case 'submit':
      return entry.requireApproval && has(actor, AUTHORS);
    case 'approve':
    case 'requestChanges':
      return has(actor, APPROVERS);
    case 'publish':
      // With approval, a page in review is approved, not published past its reviewer.
      return entry.requireApproval ? has(actor, APPROVERS) && entry.state !== 'in_review' : has(actor, EDITORS);
    case 'unpublish':
      return entry.live && has(actor, EDITORS);
    case 'archive':
    case 'restore':
      return has(actor, EDITORS);
  }
}

/** Every action `actor` may take on `entry`, in a stable order. */
export function allowedActions(entry: WorkflowEntry, actor: WorkflowActor): WorkflowAction[] {
  return (Object.keys(WORKFLOW_TRANSITIONS) as WorkflowAction[]).filter((action) => canTake(action, entry, actor));
}

/** Why `actor` may not take `action`, or null when they may. */
export function refusal(action: WorkflowAction, entry: WorkflowEntry, actor: WorkflowActor): { code: string; detail: string } | null {
  if (canTake(action, entry, actor)) return null;
  if (!WORKFLOW_TRANSITIONS[action].from.includes(entry.state)) {
    return { code: 'workflow_state', detail: stateDetail(action, entry.state) };
  }
  if (action === 'submit' && !entry.requireApproval) {
    return { code: 'approval_not_required', detail: 'This space publishes without review. Publish the page instead.' };
  }
  if (action === 'unpublish' && !entry.live) return { code: 'not_published', detail: 'This is not published.' };
  if (entry.requireApproval && (action === 'publish' || action === 'approve' || action === 'requestChanges')) {
    return {
      code: 'approval_required',
      detail:
        action === 'publish' && entry.state === 'in_review'
          ? 'This page is waiting for review. Approve it to publish it.'
          : 'This space needs approval to publish: send the page for review, and a space admin will publish it.',
    };
  }
  return { code: 'insufficient_role', detail: 'Your role cannot do this.' };
}

/**
 * Why `actor` may not schedule `action` for later, or null when they may (docs/build/17-scheduling-releases-webhooks.md).
 * Only who is asking is checked now, as for publishing: what the page is like then (complete, live) is checked when it
 * runs, so a page can be scheduled to go live and to come down again while it is still a draft.
 */
export function scheduleRefusal(
  action: 'publish' | 'unpublish',
  entry: WorkflowEntry,
  actor: WorkflowActor,
): { code: string; detail: string } | null {
  if (entry.state === 'archived') return { code: 'workflow_state', detail: stateDetail(action, entry.state) };
  const approval = action === 'publish' && entry.requireApproval;
  if (has(actor, approval ? APPROVERS : EDITORS)) return null;
  return approval
    ? { code: 'approval_required', detail: 'This space needs approval to publish: only space admins schedule publishing.' }
    : { code: 'insufficient_role', detail: 'Your role cannot do this.' };
}

/** The state an entry is in, from what is stored: a published page with newer changes is a draft again. */
export function workflowState(entry: { status: EntryStatus; currentVersionId: string | null; publishedVersionId: string | null }): WorkflowState {
  if (entry.status === 'archived') return 'archived';
  if (entry.status === 'in_review') return 'in_review';
  return entry.publishedVersionId !== null && entry.publishedVersionId === entry.currentVersionId ? 'published' : 'draft';
}

/** The stored status for a state: the table keeps `published` for any page with a live version. */
export function storedStatus(state: WorkflowState, live: boolean): EntryStatus {
  if (state === 'archived' || state === 'in_review') return state;
  return live ? 'published' : 'draft';
}

function stateDetail(action: WorkflowAction, state: WorkflowState): string {
  if (state === 'archived') return 'This page is archived. Restore it first.';
  switch (action) {
    case 'submit':
      return state === 'in_review' ? 'This page is already waiting for review.' : 'There are no changes to review.';
    case 'approve':
    case 'requestChanges':
      return 'This page is not waiting for review.';
    case 'publish':
      return 'There are no changes to publish.';
    case 'restore':
      return 'This page is not archived.';
    default:
      return 'This cannot be done to the page as it is now.';
  }
}
