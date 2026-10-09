# admin-settings

Space settings (packages 08, 11 and 14):

- **Settings** (`/spaces/:spaceId/settings`), for everyone in the space: links to the screens below the role allows.
- **Site settings** (`settings/site`): the `siteSettings` singleton in a form of its own (the content model's fields:
  name, logo, browser tab icon, sharing image, contact details, social media, analytics ID). Save draft for authors and
  up, Publish changes for editors and up; the same validation as the API, with an error summary.
- **Navigation** (`settings/navigation`): the `navigation` singleton as trees (main menu with sub-links, footer
  columns of links). Items use the page form's controls (`nv-field`: label, link to a page or a web address); buttons
  add, move up and down, make an item a sub-link of the one above and back, and remove, each announced with focus kept
  on the item. `nav-tree.ts` holds the tree operations (pure). Both singleton screens share `SingletonEditor`.
- **Redirects** (`settings/redirects`): every member sees them, editors and up add, change and delete them (409s from
  the API, such as a published page at the address, are shown as they come), import a CSV file (parsed and checked here
  with `parseRedirectsCsv` first, line by line) and download them all as CSV. `?from=` fills in the old address.
- **Missing pages** (`settings/missing-pages`): addresses visitors found no page at over 7, 30 or 90 days, most visited
  first, each with "Redirect it" for editors and up.
- **API tokens** (`settings/api-tokens`), for admins, developers and agency staff: the space's delivery and preview
  tokens with their hint, creator and last use; create a token (its secret is shown once, with a copy button, and focus
  moves to it) and revoke one after confirmation. Other roles have no link, and the route guard sends them to the
  space's dashboard; the API and RLS refuse them too.
- **Space settings** (`settings/space`), for space admins and agency staff: the space's name and site address (used
  for "View live page"). Ctrl+S saves; leaving with unsaved changes asks first.

Run `nx test admin-settings`; the `@seo`, `@api-tokens` and `@shell` e2e journeys cover the screens with axe checks.