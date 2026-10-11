# api-audit

The audit log screen's API (docs/build/18-search-forms-audit.md): `GET /v1/management/spaces/:spaceId/audit-events`,
filtered by person, action and UK day, a page at a time; `/actors` for the person filter; `/export` as CSV; and
`/:id/content-diff`, what a publish or restore changed in a page. Space admins and agency staff only, as RLS on
`audit_events` (0004). Events are written by every feature with `recordAudit` (`@novan/api-db`).
