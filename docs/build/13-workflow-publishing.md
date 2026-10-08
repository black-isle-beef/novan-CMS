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

## Decisions made during this package

- **State machine** (`libs/api/content/src/lib/workflow.ts`, pure): actions `edit`, `submit`, `approve`,
  `requestChanges`, `publish`, `unpublish`, `archive`, `restore`. The state is derived from what is stored: `in_review`
  and `archived` come from `entries.status`; otherwise a page whose current version is its published one is
  `published`, and anything else is `draft` (so a live page with new edits is a draft again, as the plan says). The
  `status` column keeps `published` for any page with a live version. Republishing a published page is allowed (it
  refreshes the live copy and checks it against today's files and model). `workflow.spec.ts` lists every allowed and
  forbidden action for every role, state and approval setting.
- **Who does what.** Without approval: editors, developers and admins publish; nobody submits. With approval
  (`spaces.require_approval`, set by space admins in Space settings): authors, editors and developers submit; space
  admins and agency staff (with a second factor) approve, ask for changes (a comment is required) or publish directly.
  Developers are not approvers: the plan names admins and agency staff. Unpublish, archive and restore stay with
  editors and up.
- **The API decides first, the database again** (`0011_workflow.sql`): the entries guard lets authors move a page to
  and from review only, and with approval on refuses a new published version from anyone but a space admin or agency
  staff. `review_requests` holds each submission and its decision (one open per page; decided once; approve and ask
  for changes need an admin), with RLS and pgTAP cross-tenant tests (`workflow.test.sql`).
- **Endpoints:** `GET .../entries/:id/workflow` (state, live, approval, the caller's actions, latest review),
  `POST .../submit`, `.../approve`, `.../request-changes`, `.../archive`, `.../unarchive`, `GET .../references` (pages
  whose draft or published data mention the id: references and internal links), `GET .../reviews` (the inbox), and
  `POST .../publish` takes an optional `message`. The admin shows only the actions `workflow` returns.
- **Edits leave review.** Saving, autosaving or restoring a version of a page in review closes its request as
  `withdrawn` and returns it to draft (or `published`, when live): it has to be sent again, so nothing changes after
  approval was asked for. Unpublishing, archiving and the bin withdraw an open request too. Archived pages cannot be
  edited (409 `workflow_state`) until restored.
- **Publish message:** when given, the current version is saved again with the message, and that version is
  published (versions are immutable).
- **Email** goes through `Mailer` (`libs/api/common`): `MAIL_PROVIDER` = `mailpit` (default outside production; local
  Supabase's inbox, which the e2e tests read), `resend`, `postmark` (both over HTTPS, no SDK) or `log` (production
  default until one is set). Review requested → the space's admins; changes requested and approved → whoever
  submitted. Addresses are read with the service role. Sending never fails the action.
- **Admin:** `PageWorkflow` (`@novan/admin-content`) is shared by the form view and the visual editor: the review
  banner, the actions, the publish/approve dialog (changes since the live version side by side, the pre-publish
  checklist from 12c, which now lives in `@novan/admin-content`, and an optional message), submit and request-changes
  dialogs, and "Compare with live" for reviewers. Unpublishing uses the confirm dialog, naming the linking pages.
  Publishing and submitting need the page complete; unsaved changes are saved first. The dashboard lists pages
  waiting for review first; "Drafts awaiting review" is now "Changes not live yet". The recycle bin is
  `/spaces/:id/content/bin` (restore for editors and up; purge stays in 17).

## Out of scope

Scheduled publishing and releases (17).

## Verify

```bash
npx nx test api                        # every allowed and forbidden transition per role
npx nx e2e admin-e2e --grep @workflow  # approval on: author submits, admin approves, page goes live
```

## Definition of done

- [x] Workflow rules live in one tested module used by API and reflected in UI state
- [x] Notifications sent (captured by a test mailer in e2e)
