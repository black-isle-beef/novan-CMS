import { type WorkflowAction, workflowActions, type WorkflowState, workflowStates } from '@novan/shared-schemas';
import { allowedActions, canTake, refusal, storedStatus, type WorkflowActor, workflowState } from './workflow';

type Who = 'admin' | 'developer' | 'editor' | 'author' | 'viewer' | 'staff' | 'outsider';

const actors: Record<Who, WorkflowActor> = {
  admin: { role: 'admin', agencyStaff: false },
  developer: { role: 'developer', agencyStaff: false },
  editor: { role: 'editor', agencyStaff: false },
  author: { role: 'author', agencyStaff: false },
  viewer: { role: 'viewer', agencyStaff: false },
  // Agency staff with a second factor; without one they arrive as `outsider` (no role, no staff access).
  staff: { role: null, agencyStaff: true },
  outsider: { role: null, agencyStaff: false },
};

/**
 * The whole table, written out: what each person may do in each state, without and with approval. A page that is
 * `draft` with `live` true has a published version and newer changes.
 */
const expected: Record<'off' | 'on', Record<string, Partial<Record<Who, WorkflowAction[]>>>> = {
  off: {
    'draft': {
      admin: ['edit', 'publish', 'archive'],
      developer: ['edit', 'publish', 'archive'],
      editor: ['edit', 'publish', 'archive'],
      author: ['edit'],
      staff: ['edit', 'publish', 'archive'],
    },
    'draft+live': {
      admin: ['edit', 'publish', 'unpublish', 'archive'],
      developer: ['edit', 'publish', 'unpublish', 'archive'],
      editor: ['edit', 'publish', 'unpublish', 'archive'],
      author: ['edit'],
      staff: ['edit', 'publish', 'unpublish', 'archive'],
    },
    // Left in review when approval was turned off: editors publish it; only reviewers send it back.
    'in_review': {
      admin: ['edit', 'approve', 'requestChanges', 'publish', 'archive'],
      developer: ['edit', 'publish', 'archive'],
      editor: ['edit', 'publish', 'archive'],
      author: ['edit'],
      staff: ['edit', 'approve', 'requestChanges', 'publish', 'archive'],
    },
    'published+live': {
      admin: ['edit', 'publish', 'unpublish', 'archive'],
      developer: ['edit', 'publish', 'unpublish', 'archive'],
      editor: ['edit', 'publish', 'unpublish', 'archive'],
      author: ['edit'],
      staff: ['edit', 'publish', 'unpublish', 'archive'],
    },
    'archived': {
      admin: ['restore'],
      developer: ['restore'],
      editor: ['restore'],
      staff: ['restore'],
    },
  },
  on: {
    'draft': {
      admin: ['edit', 'submit', 'publish', 'archive'],
      developer: ['edit', 'submit', 'archive'],
      editor: ['edit', 'submit', 'archive'],
      author: ['edit', 'submit'],
      staff: ['edit', 'submit', 'publish', 'archive'],
    },
    'draft+live': {
      admin: ['edit', 'submit', 'publish', 'unpublish', 'archive'],
      developer: ['edit', 'submit', 'unpublish', 'archive'],
      editor: ['edit', 'submit', 'unpublish', 'archive'],
      author: ['edit', 'submit'],
      staff: ['edit', 'submit', 'publish', 'unpublish', 'archive'],
    },
    'in_review': {
      admin: ['edit', 'approve', 'requestChanges', 'archive'],
      developer: ['edit', 'archive'],
      editor: ['edit', 'archive'],
      author: ['edit'],
      staff: ['edit', 'approve', 'requestChanges', 'archive'],
    },
    'published+live': {
      admin: ['edit', 'publish', 'unpublish', 'archive'],
      developer: ['edit', 'unpublish', 'archive'],
      editor: ['edit', 'unpublish', 'archive'],
      author: ['edit'],
      staff: ['edit', 'publish', 'unpublish', 'archive'],
    },
    'archived': {
      admin: ['restore'],
      developer: ['restore'],
      editor: ['restore'],
      staff: ['restore'],
    },
  },
};

const cases = (['off', 'on'] as const).flatMap((approval) =>
  Object.entries(expected[approval]).flatMap(([key, byWho]) =>
    (Object.keys(actors) as Who[]).map((who) => ({ approval, key, who, allowed: byWho[who] ?? [] })),
  ),
);

function entryFor(approval: 'off' | 'on', key: string) {
  const [state, live] = key.split('+') as [WorkflowState, string | undefined];
  return { state, live: live === 'live', requireApproval: approval === 'on' };
}

describe('workflow', () => {
  it.each(cases)('approval $approval, $key: $who may $allowed', ({ approval, key, who, allowed }) => {
    const entry = entryFor(approval, key);
    expect(allowedActions(entry, actors[who])).toEqual(allowed);
    // And every other action is refused, with a reason.
    for (const action of workflowActions) {
      expect(canTake(action, entry, actors[who])).toBe(allowed.includes(action));
      expect(refusal(action, entry, actors[who]) === null).toBe(allowed.includes(action));
    }
  });

  it('covers every state', () => {
    const keys = Object.keys(expected.on).map((key) => key.split('+')[0]);
    expect(new Set(keys)).toEqual(new Set(workflowStates));
  });

  it('explains refusals in terms people can act on', () => {
    const draft = { state: 'draft' as const, live: false, requireApproval: true };
    expect(refusal('publish', draft, actors.editor)).toMatchObject({ code: 'approval_required' });
    expect(refusal('publish', { ...draft, state: 'in_review' }, actors.admin)?.detail).toContain('Approve it');
    expect(refusal('submit', { ...draft, requireApproval: false }, actors.author)).toMatchObject({ code: 'approval_not_required' });
    expect(refusal('approve', draft, actors.admin)).toMatchObject({ code: 'workflow_state' });
    expect(refusal('edit', { ...draft, state: 'archived' }, actors.admin)?.detail).toContain('Restore it first');
    expect(refusal('unpublish', draft, actors.editor)).toMatchObject({ code: 'not_published' });
    expect(refusal('archive', draft, actors.author)).toMatchObject({ code: 'insufficient_role' });
  });

  it('reads the state from what is stored, and stores it back', () => {
    expect(workflowState({ status: 'published', currentVersionId: 'v2', publishedVersionId: 'v2' })).toBe('published');
    expect(workflowState({ status: 'published', currentVersionId: 'v3', publishedVersionId: 'v2' })).toBe('draft');
    expect(workflowState({ status: 'draft', currentVersionId: 'v1', publishedVersionId: null })).toBe('draft');
    expect(workflowState({ status: 'in_review', currentVersionId: 'v3', publishedVersionId: 'v2' })).toBe('in_review');
    expect(workflowState({ status: 'archived', currentVersionId: 'v1', publishedVersionId: null })).toBe('archived');
    expect(storedStatus('draft', true)).toBe('published');
    expect(storedStatus('draft', false)).toBe('draft');
    expect(storedStatus('in_review', true)).toBe('in_review');
  });
});
