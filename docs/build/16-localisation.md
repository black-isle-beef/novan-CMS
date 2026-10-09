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

## Decisions (made while building this package)

- **One entry holds every locale.** `entries.locale`, `published_content.locale` and `spaces.default_locale` are
  dropped (`0013_localisation.sql`); the default locale is `space_locales.is_default`. An entry's slug, and so its
  address, is the same in every locale.
- **Only value fields are translated.** `group` and `blocks` fields are structure every locale shares (the same blocks,
  in the same order); the fields inside them are translated when marked. The schema refuses `localised` on a group or
  blocks field, and on a content type's top-level `slug`. The migration clears those flags on existing models (the
  seed had set them) before wrapping data. Translating a field later, or no longer translating it, never invalidates
  stored data: `buildEntrySchema` reads a plain value as the default locale's, and a locale map as its default value.
- **Fallbacks** follow `fallback_code` links (no circles, checked at commit). A locale with no fallback shows nothing
  for a missing translation. A page is *in* a locale when something translated shows along that locale's chain, or it
  has nothing translated at all; otherwise the Delivery API answers 404 there and leaves it out of `alternates` and
  the sitemap.
- **Locale prefixes** are `spaces.locale_prefixes` (space admins) plus `space_locales.path_prefix` (a column added to
  the list in task 1, defaulting to the language, e.g. `fr`). With prefixes on, the Delivery API returns the site's
  addresses in the requested locale (`/fr/about`) for pages, internal links, site addresses in rich text, alternates
  and the sitemap; `pages?path=` still takes the path without a prefix.
- **Machine translation** fills the target locale's empty translations from the default locale (text, rich text and
  link text translated, other values copied) and saves a new draft version whose message says it was
  machine-translated; nothing is published. `TRANSLATOR` picks the provider: unset (no provider yet) hides the action,
  `pseudo` marks text for development and tests.
- **Client-facing copy says "language"**, never "locale" (Settings › Languages).

## Verify

```bash
npm run db:test
npx nx test shared-schemas api cms-angular
npx nx e2e admin-e2e --grep @i18n   # add fr-FR, translate home, fallback works for untranslated page
```

## Definition of done

- [ ] Existing content migrated without loss (tested on a copy of production data)
- [x] Fallbacks and hreflang correct

The migration refuses to run if unwrapping any wrapped value would not give back the data it started from. It has been
applied to a copy of a local development database (52 versions, 6 published pages) with no loss; it still needs a run
against a copy of production data before this box is ticked.

## Follow-ups (not built here)

- Redirects are site addresses without a locale prefix: with prefixes on, the automatic redirects made when a page
  moves do not cover `/fr/<old>`. Redirecting each prefixed address too is a small addition to `createNovanRedirects`.
- Translated slugs (a different address per locale) would need per-locale paths in `published_content`.
