# 16 — Localisation

**Phase:** 3 Scale · **Estimate:** 4 days · **Prerequisites:** Gate 2

## Goal

Spaces can publish content in several locales with field-level translation and fallbacks.

## Tasks

1. `space_locales (space_id, code, name, fallback_code, is_default)`; RLS + pgTAP. Default `en-GB`.
2. Content storage: translatable fields store `{ "en-GB": ..., "fr-FR": ... }` inside version data; non-localised fields store plain values. Update `buildEntrySchema` and its tests. Write a data migration for existing entries (wrap localised field values in the default locale).
3. Delivery API: `locale` parameter, fallback chain resolution, `alternates` (hreflang) in page responses.
4. Admin: locale switcher in the editor and form view; side-by-side translation view (source locale left, target right); "missing translation" indicators in the page tree.
5. SDK + starter site: locale-prefixed routes (`/fr/...`) as a space setting, `hreflang` links, `lang` attribute.
6. Optional machine-translation draft action behind a `Translator` interface (provider chosen later), clearly marked as draft.

## Verify

```bash
npm run db:test
npx nx test shared-schemas api cms-angular
npx nx e2e admin-e2e --grep @i18n   # add fr-FR, translate home, fallback works for untranslated page
```

## Definition of done

- [ ] Existing content migrated without loss (tested on a copy of production data)
- [ ] Fallbacks and hreflang correct
