# admin-dashboard

A space's home, `/spaces/:spaceId` (package 11):

- **Get started** checklist for new spaces (stored in `spaces.settings.onboarding`, 0009_onboarding.sql): add a
  logo, edit the home page, add a page, publish. Steps tick themselves when the API sees them done; authors and up
  can dismiss the list for the whole space, after confirming.
- **Recently edited** pages and **drafts awaiting review** (pages whose changes are not live yet).
- A **New page** shortcut that opens the dialog on the Pages screen (`?add=page`).

Run `nx test admin-dashboard`; the `@shell` e2e journey covers the checklist with axe checks.
