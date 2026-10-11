# api-forms

Forms (docs/build/18-search-forms-audit.md).

- `FormSubmissions`: what the Delivery API's `POST /v1/delivery/forms/:formUid/submit` (in `api-delivery`) calls. The
  form must be on a page published in the token's space; its fields there decide what is accepted. A honeypot field,
  Cloudflare Turnstile (`TURNSTILE_SECRET_KEY`) and per-visitor and per-token limits keep robots out.
- `FormNotifier`: emails the space's recipients about each submission, from the `notifications` queue.
- `FormsHousekeeping`: deletes submissions past the space's retention (12 months unless set), nightly.
- `FormsController`: the inbox under `/v1/management/spaces/:spaceId/forms` (list, view, delete, CSV export, settings).

Submissions and settings are in `supabase/migrations/0020_forms.sql`.
