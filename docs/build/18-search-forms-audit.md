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

## Definition of done

- [ ] Search returns results within 100 ms on 10,000 seeded entries
- [ ] Form submissions protected against spam and stored with retention
