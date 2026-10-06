# 11 — Admin shell and client mode

**Phase:** 2 Visual editor + pilot · **Estimate:** 3 days · **Prerequisites:** Gate 1

## Goal

One admin app that feels simple to clients and complete to the agency: navigation and wording change by role, and new spaces open with a guided checklist.

## Tasks

1. Role-aware shell (`libs/admin/shell`): left navigation built from a config of `{ label, route, icon, permission }`.
   - Client roles (`editor`, `author`, `viewer`): Pages, Media, Forms (placeholder until 18), Settings (site settings singleton, team).
   - Agency roles (`admin`, `developer`, agency staff): adds Schema, API tokens, Webhooks, Audit log, Space settings.
   - Route guards mirror the menu; API permissions remain the real enforcement.
2. Plain-language copy layer: a small dictionary so client views say "Page", "Publish", "Save draft", "Restore this version". No "entry", "environment" or "content type" visible to client roles (add an e2e test that scans client-mode pages for these words).
3. Dashboard: recently edited pages, drafts awaiting review, quick "New page" action.
4. Onboarding checklist for new spaces (stored in `spaces.settings.onboarding`): add logo, edit home page, add a page, publish. Dismissible.
5. Agency impersonation: agency staff can "view as" a member role (UI only, read-only banner, logged to audit). No impersonating writes.
6. Global UX: toast notifications, confirm dialogs for destructive actions, unsaved-changes guard, keyboard shortcuts (`Ctrl+S` save, `Ctrl+Shift+P` publish), loading skeletons. All from the Novan Design System where components exist.
7. Performance budget: admin initial bundle ≤ 800 kB (existing Nx budget), lazy-load every feature lib.

## Decisions made during this package

- **Libraries:** `libs/admin/shell` (`@novan/admin-shell`: layout, menu config, copy, confirm, shortcuts,
  unsaved-changes guard, skeletons, placeholder screens) and `libs/admin/dashboard`. Feature libraries may import
  the shell; the shell imports none of them. Every feature library is reached through `loadChildren`.
- **Menu and permissions:** `spaceNav` items carry a permission (`space.read`, `content.read`, `media.read`,
  `schema.write`, `settings.update`, `audit.read`, `space.update`) granted as in the default roles (0001), so the
  menu and guards (`requirePermission` in `@novan/admin-spaces`) match what the API and RLS allow. Developers
  therefore get Schema, API tokens and Webhooks, but not Audit log (only admins read `audit_events`) or Space
  settings (only admins update `spaces`). Client Settings is an overview linking to the `siteSettings` singleton
  (in the page editor) and the team (the members page, now titled "Team").
- **Routes:** `/spaces/:id` is the dashboard (it was the content list); the content list is titled "Pages". New
  spaces open on their dashboard. Forms, Webhooks and Audit log are placeholder screens until 18 and 17.
- **Onboarding** (`0009_onboarding.sql`): `spaces.settings.onboarding = { completed: { <step>: <when> },
  dismissedAt }`, written only through two security-definer functions that check the caller's role from the JWT
  claims (authors and up, agency staff): `complete_onboarding_step` and `dismiss_onboarding`. The API records
  steps in the same transaction as the change: `newPage` when a page is created, `homePage` when the top-level
  `home` page is saved or autosaved, `publish` on any publish, and `logo` when an image is uploaded (until 14 adds
  a logo field to site settings). Spaces created through the API start with an empty checklist; seeded and older
  spaces have none. Endpoints: `GET /spaces/:id/onboarding`, `POST /spaces/:id/onboarding/dismiss`.
- **View as:** UI only. `ViewAs` (in `@novan/admin-auth`, so the interceptor stays out of the shell's bundle)
  holds `{ spaceId, role }` in memory; a reload ends it. The menu, guards and `SpaceContext` follow the viewed role,
  edit and publish rights are off, and `viewAsReadOnlyInterceptor` refuses every non-GET request with a local
  `view_as_read_only` problem. `POST /spaces/:id/view-as { role | null }` (agency staff only) audits
  `view_as.started` / `view_as.stopped`; starting waits for the audit record, stopping does not.
- **Space settings:** `PATCH /spaces/:id` (space admins, agency staff) renames the space or sets its site
  address (http/https only, trailing slash dropped), audited as `space.updated` with before and after values.
- **Global UX:** toasts from `DsToastService` (container in the shell); `Confirm` asks before unpublishing,
  dismissing the checklist and leaving unsaved changes (existing delete/revoke dialogs stay as they were);
  `unsavedChangesGuard` + `warnBeforeUnload` on the page editor and Space settings; Ctrl/⌘+S saves (page editor,
  type editor, Space settings) and Ctrl/⌘+Shift+P publishes (page editor), with `aria-keyshortcuts` and a visible
  hint. Firefox keeps Ctrl+Shift+P for a private window. Skeletons are Bootstrap placeholders (the design system
  has no skeleton component).
- **Copy:** client screens take shared words from `copy.ts`; `agencyOnlyWords` is the list the `@shell` e2e test
  scans for (visible text, accessible names and the title) on every client screen, including the page editor. The
  API's "no such page or entry" message now says "This page does not exist, or has been deleted."
- **Seed:** `developer@novan.test` (password `password123`), a developer of the demo site without agency rights.
- **Bundle:** the admin's initial bundle was 1.05 MB on `main`. Lazy-loading every library, moving the shell out
  of the bootstrap path and replacing `supabase-js` with `@supabase/auth-js` (storage via `@supabase/storage-js`
  in the media library) brings it to 854 kB: 395 kB of JavaScript (Angular 330 kB, auth-js 129 kB) and the
  design system's 459 kB stylesheet, which alone holds the full Bootstrap Icons set (84 kB, 2,078 glyphs).
  **Open:** the last 54 kB is to be fixed in the design system (a stylesheet entry without the icon font, or with
  only the icons used), not by copying its stylesheet here. Until then `nx build admin` warns about the budget.

## Out of scope

Billing and plan limits UI (phase 4).

## Verify

```bash
npx nx test admin-shell
npx nx e2e admin-e2e --grep @shell   # editor sees client nav only; developer sees schema; forbidden words test
```

## Definition of done

- [x] Client and agency modes verified by e2e
- [x] Accessibility audit clean on shell, dashboard and checklist
