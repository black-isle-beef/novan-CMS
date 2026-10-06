# admin-shell

The signed-in layout of the admin and its global UX (package 11):

- **`AdminShell`**: the header (space switcher, "View as" for agency staff, sign out) and the role-aware space
  menu (`ds-sidebar`), built from `spaceNav` in `nav/space-nav.ts`: `{ label, route, icon, permission }`. Client
  roles get Dashboard, Pages, Media, Forms and Settings; admins and developers also get the technical screens their
  role allows (Schema, API tokens, Webhooks, and for admins Audit log and Space settings). Route guards
  (`requirePermission` in `@novan/admin-spaces`) check the same permissions; the API is the real enforcement.
  Below Bootstrap's `md` breakpoint the space menu moves into the header's menu button.
- **Plain-language copy** (`copy/copy.ts`): the words shared screens use. Client roles never see "entry",
  "environment" or "content type" (`agencyOnlyWords`; the `@shell` e2e journey scans every client screen).
- **View as**: agency staff see a space as one of its roles: the menu, guards and screens follow that role, a
  banner stays on every screen, and writes are refused (`viewAsReadOnlyInterceptor` in `@novan/admin-auth`).
  Starting and stopping are audited (`POST /v1/management/spaces/:spaceId/view-as`).
- **Global UX**: toasts (`ds-toast-container`; raise them with `DsToastService`), `Confirm` for destructive
  actions, `unsavedChangesGuard` and `warnBeforeUnload`, keyboard shortcuts (`Shortcuts`: Ctrl+S saves,
  Ctrl+Shift+P publishes, ⌘ on a Mac), `<nv-skeleton>` loading placeholders, and placeholder screens for
  Forms (18), Webhooks (17) and the Audit log (18).

Feature libraries may import this one; it must not import them. Run `nx test admin-shell`.
