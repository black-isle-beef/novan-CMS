# 13 — Workflow and publishing

**Phase:** 2 Visual editor + pilot · **Estimate:** 3 days · **Prerequisites:** 12

## Goal

Clear draft → review → publish states, optional approval per space, safe unpublishing and easy restore.

## Tasks

1. State machine in `libs/api/content/workflow.ts` (pure, unit-tested): `draft → in_review → published`, `published → draft` (new edits), `any → archived`, `archived → draft`. Transitions check role permissions.
2. Space setting `requireApproval` (default off). When on, `author` and `editor` client roles submit for review; space `admin` or agency staff approve or request changes with a comment.
3. Review UI: "Submit for review" button, reviewer inbox on the dashboard, side-by-side diff (draft vs live), approve / request changes.
4. Email notifications through Supabase Auth's SMTP settings or a transactional provider (Resend/Postmark) behind a `Mailer` interface: review requested, changes requested, published.
5. Publish dialog: summary of changes, pre-publish checklist from 12, optional message saved on the version.
6. Unpublish confirm dialog naming affected links (pages that reference this one).
7. Recycle bin view for deleted pages with restore (purge after 30 days happens in 17).

## Out of scope

Scheduled publishing and releases (17).

## Verify

```bash
npx nx test api                        # every allowed and forbidden transition per role
npx nx e2e admin-e2e --grep @workflow  # approval on: author submits, admin approves, page goes live
```

## Definition of done

- [ ] Workflow rules live in one tested module used by API and reflected in UI state
- [ ] Notifications sent (captured by a test mailer in e2e)
