# api-spaces

`/v1/management/me`, `/spaces`, `/spaces/:spaceId/members` and `/spaces/:spaceId/invites` (package 03).

Every query runs through `DbService.userDb`, so row-level security applies, and every write records an
`audit_events` row in the same transaction (`recordAudit` in `@novan/api-db`).
