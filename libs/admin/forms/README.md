# admin-forms

The Forms inbox, `/spaces/:spaceId/forms` (docs/build/18-search-forms-audit.md), for space admins and editors (and
agency staff), who the route guard (`forms.read`), the API and RLS all allow:

- **Messages** sent through the site's forms, newest first, all together or one form at a time, with the form, page and
  first answer. **Read** opens a message beside the list (focus moves to it); `?submission=<id>` opens one directly (the
  link in the email about it).
- **Download as a spreadsheet**: one form's messages as CSV.
- **Delete** a message, after confirming.
- **Emails and keeping messages**: who is emailed about new messages and how many months messages are kept. Admins
  change them (`forms.settings`); editors see them.

Run `nx test admin-forms`; the `@search-forms-audit` admin e2e journey reads a message sent through the Delivery API,
with axe.
