# 22 — Phase 4 backlog (build on demand)

Nothing here starts until Gate 3 is met **and** a client or a clear business reason asks for it. When an item is picked up, turn it into a numbered package file using the same structure as 01–19.

| Item | Trigger to start | Notes |
| --- | --- | --- |
| GraphQL Delivery API | A client front-end team asks for it | Generate schema from content types; reuse delivery services and cache tags |
| Environments UI (staging/main schema branches + merge) | Schema changes start breaking live sites | Tables already support `environment_id` |
| Plugin system (custom field types, sidebar apps) | Two clients need the same custom field | Field plugins as Angular components loaded by URL with a manifest; sandbox in an iframe |
| AI writing assistant | Clients ask for help writing copy or alt text | Behind a provider interface; drafts only, never auto-publish |
| A/B tests and personalisation | A client runs campaigns | Block variants + edge assignment in Cloudflare Workers |
| Multi-tenant site renderer | More than ~10 brochure clients | One Angular SSR app serving many domains, space chosen by hostname, theming via design system tokens |
| Hosted SaaS for other agencies | Decision to sell Novan CMS | Billing (Stripe), plan limits, organisation self-signup, usage metering, terms and DPA, status page |
| Meilisearch | Postgres search too slow or not relevant enough | Swap behind `SearchProvider` from 18 |
| Video hosting/transcoding | Clients upload video regularly | Use Cloudflare Stream or Mux rather than building |
| Self-hosted Supabase | Cost or data-residency need | Same migrations; run `supabase` Docker stack; test restore and auth hook first |
