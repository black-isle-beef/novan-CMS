# admin-settings

Space settings (packages 08 and 11):

- **Settings** (`/spaces/:spaceId/settings`), for everyone in the space: links to the site settings (the
  `siteSettings` singleton, opened in the page editor) and the team, plus the screens below when the role allows.
- **API tokens** (`/spaces/:spaceId/settings/api-tokens`), for admins, developers and agency staff: the space's
  delivery and preview tokens with their hint, creator and last use; create a token (its secret is shown once,
  with a copy button, and focus moves to it) and revoke one after confirmation. Other roles have no link, and the
  route guard sends them to the space's dashboard; the API and RLS refuse them too.
- **Space settings** (`/spaces/:spaceId/settings/space`), for space admins and agency staff: the space's name and
  site address (used for "View live page"). Ctrl+S saves; leaving with unsaved changes asks first.

Run `nx test admin-settings`; the `@api-tokens` and `@shell` e2e journeys cover the screens with axe checks.
