# 18 — Search, forms and audit log

**Phase:** 3 Scale · **Estimate:** 5 days · **Prerequisites:** 17

## Tasks

### Search
1. Postgres full-text search: generated `tsvector` column on `published_content` (title + text extracted from blocks and rich text, weighted) with a GIN index; same for drafts in an `entry_search` table updated on save.
2. Admin global search (Ctrl+K) across pages, entries and media.
3. Delivery API `q` parameter with ranking and highlighted snippets; `<novan-search>` component in the SDK for client sites.
4. Leave a `SearchProvider` interface so Meilisearch can replace Postgres later without API changes.

### Forms
5. `form` block (fields: text, email, textarea, select, checkbox, consent) built with the `create-angular-cms-component` skill.
6. Submissions endpoint `POST /v1/delivery/forms/:formUid/submit` with Cloudflare Turnstile verification, rate limiting and server-side validation; `form_submissions (id, space_id, entry_id, form_uid, data jsonb, created_at)`.
7. Admin Forms inbox: list, view, export CSV, delete; email notification to configured recipients; retention setting (default 12 months) enforced by housekeeping.

### Audit log
8. Admin Audit log screen for space admins: filter by user, action, date; diff viewer for content changes. Export CSV.

## Verify

```bash
npm run db:test
npx nx test api cms-angular blocks
npx nx e2e starter-site-e2e --grep @forms   # submit form -> appears in inbox, email captured
```

## As built

- Search (0019, `libs/api/search`): `search_text()` pulls the text visitors read out of entry data (block names, ids,
  addresses and node types are left out) and `search_document()` weights it (A title, B SEO, C the rest), stemmed with
  the `english` configuration. `published_content.search` and `assets.search` are generated columns; `entry_search` is
  kept by triggers on every save and autosave. All three have GIN indexes. A translated value counts in every locale;
  snippets are cut from the requested locale. Words must all match and the last may be unfinished (`garden tou`).
- `SearchProvider` (Postgres now) serves `GET entries?q=` on the Delivery and Preview APIs (best match first, each entry
  with `search: { rank, snippet }`; `q` combines with `type`, not field filters or another sort) and
  `GET /v1/management/spaces/:spaceId/search` for the admin's Ctrl+K. Snippets are plain text parts, never HTML.
  Measured locally on 10,000 published entries: about 20–25 ms a request (`apps/api/src/app/search.spec.ts`).
- Forms (0020, `libs/api/forms`): the form block names its submissions by its `_uid`; the site sends the page's id with
  them (`<novan-blocks [entryId]>`, `NOVAN_BLOCK_CONTEXT`). Recipients and retention are per space (`form_settings`, set
  by admins in the inbox); a submission's email goes through a `notifications` queue. Spam: a honeypot field, Cloudflare
  Turnstile (`TURNSTILE_SECRET_KEY`; none locally, refused in production without it) and limits of 5 a minute per
  visitor and 120 per token (`FORM_RATE_LIMIT`, `FORM_TOKEN_RATE_LIMIT`). The SDK's proxy passes the visitor's address.
- Submissions hold personal data: admins and editors (and agency staff) read, delete and export them; developers,
  authors and viewers do not, and the admin's Forms menu follows (`forms.read`). Deletes, exports and settings changes
  are audited without the answers. CSV exports defuse spreadsheet formulas.
- The starter site has `/search` (`<novan-search>`); the contact page has a seeded form.
- Audit log (0021, `libs/api/audit`): filters by person, action or kind of action (`entry`) and UK calendar day, cursor
  pages, CSV export (itself audited), and for publishes and restores the content change between the versions recorded.

## Definition of done

- [ ] Search returns results within 100 ms on 10,000 seeded entries
- [ ] Form submissions protected against spam and stored with retention
