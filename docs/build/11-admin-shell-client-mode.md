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

## Out of scope

Billing and plan limits UI (phase 4).

## Verify

```bash
npx nx test admin-shell
npx nx e2e admin-e2e --grep @shell   # editor sees client nav only; developer sees schema; forbidden words test
```

## Definition of done

- [ ] Client and agency modes verified by e2e
- [ ] Accessibility audit clean on shell, dashboard and checklist
