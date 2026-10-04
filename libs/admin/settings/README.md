# admin-settings

Space settings, for admins, developers and agency staff (package 08):

- **API tokens** (`/spaces/:spaceId/settings/api-tokens`): the space's delivery and preview tokens with their
  hint, creator and last use; create a token (its secret is shown once, with a copy button, and focus moves to
  it) and revoke one after confirmation. Editors, authors and viewers have no Settings link, and the route
  guard sends them to the space home; the API and RLS refuse them too.

Run `nx test admin-settings`; the `@api-tokens` e2e journey covers the flow with axe checks and uses the new
token against the Delivery API.
