# 24 — Bring-your-own design system and class overrides

**Phase:** 4 Grow · **Estimate:** 20 days (split into 24a–24f PRs) · **Prerequisites:** 12, 19, 23

## Goal

A space's developers upload their own CSS framework or design system (a CSS file, a CDN address or a zip package),
attach it to the space's site, place its custom components on pages in the visual editor, and add utility classes
to any part of any block — Novan blocks and custom ones — per breakpoint and state. The editor shows exactly what the
published page shows, and nothing uploaded can affect the admin or another space.

## Decisions (taken while planning; they override the original feature brief)

| Brief                                                                       | Decision                                                                                                                                             | Why                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design systems belong to a workspace and attach to sites                    | They belong to a **space** (`space_id`, the usual RLS). Attaching a version enables it on the space's site (`space_design_systems`, per environment) | The space is the tenant boundary; there is no site table and no organisation membership                                                                                                                                   |
| "Midnight" admin theme                                                      | Charcoal & Copper (package 23)                                                                                                                       | The only admin theme                                                                                                                                                                                                      |
| Move the canvas into a sandboxed iframe                                     | No change: the canvas is already the client site in a cross-origin iframe (package 12)                                                               | `sandbox` without `allow-same-origin` gives the frame a `null` origin and breaks the bridge's origin checks. Custom JS only ever runs on the client's own site origin; the admin never loads design-system files (tested) |
| A new shared renderer                                                       | Extend `<novan-blocks>` in the SDK                                                                                                                   | The canvas _is_ the site's SSR app in preview mode, so editor and live page render through the same code                                                                                                                  |
| Custom blocks as `source: "custom"` nodes with a JSON-Schema form generator | Manifest components become **block types** on attach (`block_types.design_system_component_id`); props map to `FieldDef[]`                           | Validation (`buildEntrySchema`), the picker, field forms, delivery and the upgrade diff reuse what exists                                                                                                                 |
| `styleOverrides` on blocks                                                  | Reserved key **`_overrides`**; `_style` stays named presets only (package 10)                                                                        | Reserved block keys start with `_`                                                                                                                                                                                        |
| Manifest validated by JSON Schema                                           | Zod in `@novan/shared-design-system`; a JSON Schema generated from it is published for authors                                                       | Zod is the locked validation decision                                                                                                                                                                                     |
| `tailwind.config` compiled server-side                                      | Tailwind **v4 CSS-first** only (`@import 'tailwindcss'`, `@theme`), compiled with `compile().build(candidates)`; no JS config or plugins             | A JS config is user code running on the server                                                                                                                                                                            |
| Feature flags                                                               | `spaces.settings.designSystems.{enabled,customCss}`, changed by agency staff only (as `media.allowSvg`)                                              | There is no flag mechanism                                                                                                                                                                                                |
| Multipart upload                                                            | Signed upload URL + `complete`, as the media library; a CDN address is fetched and stored server-side                                                | Existing pattern; sites never hot-link a CDN                                                                                                                                                                              |
| Admins and owners manage                                                    | **admin** and **developer** upload, attach and deprecate; every member reads                                                                         | The roles that exist                                                                                                                                                                                                      |

**Files on published sites** come through `GET /v1/design-system-files/:versionId/:path` (no auth; only `ready`
versions attached to an environment; immutable, `Cache-Tag: design-system:<versionId>`, CORS `*` for fonts and
modules), like `/v1/assets`. A public bucket would save API traffic but expose unattached and invalid uploads.

**Cascade layers** on every site, editor and live alike:

```css
@layer novan-base, ds-vendor, ds-components, novan-overrides;
```

Sites wrap their global styles in `@layer novan-base` (unlayered CSS would beat every layer). Uploaded CSS is wrapped
in `ds-vendor` / `ds-components` by the upload pipeline; scoped per-block CSS and tokens go in `novan-overrides`.
`!important` in uploaded CSS is a validation warning.

## Tasks

### 24a — Groundwork

1. `libs/shared/design-system` (`@novan/shared-design-system`): manifest Zod schema and types, generated
   `novan-ds.schema.json`, the `ClassAdapter` interface and `plain` adapter, `mergeOverrides`, `CLASS_TOKEN`,
   `cascadeLayers()`.
2. Parts on built-in blocks: each block declares `parts` in its definition and marks them with `data-novan-part`.
   `block-types.spec.ts` checks the declared and marked parts agree.

### 24b — Class overrides on built-in blocks

4. `_overrides` on block nodes (shared schema + SDK types); old pages validate and render unchanged.
5. SDK: overrides through `NOVAN_BLOCK_CONTEXT`; `NovanPart` directive; root classes merged into each block's
   `hostClasses()`; tokens as inline custom properties.
6. Cascade layers on the starter and Laws & Paws sites and the kits.
7. Editor: Classes section in the block panel (part selector, Base bucket, reset) with an accessible chips input.
   Bridge: admin → site `part`, site → admin `parts`.

### 24c — CSS-only design systems

8. Migration `0024`: tables, bucket, queue, RLS, the per-space feature flags (staff-only); pgTAP.
9. `libs/api/design-systems`: create, upload (CSS file or CDN address), process (PostCSS sanitise, layer, class
   index), attach and order; rate-limited; audited.
10. Delivery/Preview `site-styles`; the SDK puts the stylesheets in `<head>` during SSR.
11. `bootstrap` and `plain` adapters; class autocomplete; Settings › Design systems.

### 24d — Zip packages and custom components

12. Zip validation, manifest validation, SVG sanitising, template components parsed to a node tree.
13. Attach materialises components as block types; the SDK renders `NovanCustomElementHost` (the only
    `CUSTOM_ELEMENTS_SCHEMA`), `ngSkipHydration`, client-only placeholders, module scripts only where used.
14. Picker grouped by source; components grid previewed on the space's own site.

### 24e — Tailwind

15. `tailwind` adapter; precompiled CSS; CSS-first source compiled on publish with the classes in use, cached by hash;
    the editor uses the same compile endpoint (debounced) so it matches the live page.

### 24f — Versioning and polish

16. Upgrade preview diff, deprecation, copy/paste styles, conflict hints, token editor, feature-flagged scoped custom
    CSS, audit actions, `docs/design-systems.md` and a starter template download.

## Out of scope

- npm package installs built server-side (a later package).
- Tailwind JS configs and plugins.
- Raw React, Vue or Svelte components; custom elements are the only interop contract.
- Organisation-wide design systems shared across spaces.

## Verify

```bash
npx supabase db reset && npx supabase test db
npx nx affected -t lint test build
cd apps/admin-e2e && npx playwright test --grep @design-systems
```

E2E: upload the fixture package → attach → add `acme-card` → `md:px-8` on its root and `btn-primary` on the CTA's
`action` part → publish → the site's SSR HTML has the classes, the layer declaration and the ordered stylesheets; the
admin document has no design-system `<link>` or `<script>`.

## Open items

- How the publishable SDK takes the shared pure helpers (copy kept in step by a spec, as the bridge protocol, or an
  inlined secondary entry). Settled in 24a: a copy kept in step by a spec (see As built).
- Kits and client sites outside this repo need the `@layer novan-base` wrap when they move to SDK 0.8.0
  (upgrade note in `docs/clients/`).

## As built

### 24a

- **Shared library** `libs/shared/design-system` (`@novan/shared-design-system`, `scope:shared`):
  - `overrides.ts` is dependency-free: buckets (`base`, `sm`–`xl`, `hover`/`focus`/`active`/`dark`), `CLASS_TOKEN`,
    `PART_NAME`, `mergeOverrides`, `overrideTokens`, `cascadeLayers()`, and `createTemplateAdapter`, which writes a
    bucket through a template such as `md:{class}` or `{class}@md`. `plainAdapter` is that adapter with no templates
    (base only).
  - `manifest.ts` is the Zod schema for `novan-ds.json`. Props are a strict JSON Schema subset (string with
    `format` multiline/richtext/media/link, number/integer, boolean, enum, arrays of objects of those); unknown
    keywords are refused. Prop names are camelCase because they become field api ids. Tags need a hyphen; the
    HTML spec's reserved names and the `novan-` prefix are refused. `cssOnlyManifest()` writes the manifest for a
    CSS-only upload.
  - `novan-ds.schema.json` is generated from the Zod schema by `manifest.spec.ts` (`vitest -u` to refresh) and is
    in `.prettierignore` so formatting cannot make it drift.
- **SDK copy** (the open item): `libs/cms-angular/src/lib/overrides.ts` is a copy, as with the bridge protocol;
  `overrides.spec.ts` compares types, constants and behaviour on samples. The SDK exports the public parts
  (`mergeOverrides`, `PART_NAME`, `ROOT_PART`, `cascadeLayers`, adapters, types).
- **Parts:** every block's definition has `parts` (root first) and each part is marked `data-novan-part` (root on the
  host; `action` on `<novan-block-action>`'s link). Parts are named after their BEM element. `block-types.spec.ts`
  reads the static attributes from the compiled templates, child components included, so a part that only renders in
  one branch still counts. The `create-angular-cms-component` skill now asks for parts.
- **No `block_types.parts` column** (changed from the plan): the admin learns a block's parts from the site through
  the bridge (`parts`, 24b), which also covers custom components and needs no schema sync change.
- **Feature flags move to 24c**, with the first screen that needs them; class overrides on Novan blocks (24b) are
  not gated.

### 24b

- **Page model:** blocks take `_overrides` (`blockOverridesSchema` in `@novan/shared-design-system`, used by
  `buildEntrySchema` for both node shapes): `v` (a version id), `parts` (≤ 30, by part name) of buckets (`base`,
  `sm`–`xl`, `hover`/`focus`/`active`/`dark`, ≤ 50 class names each, shape-checked by `CLASS_TOKEN`) and `tokens`
  (≤ 40 custom properties with plain values). `css` is refused until 24f sanitises it. Pages without `_overrides`
  are unchanged; search skips `_` keys already.
- **SDK (0.8.0):** `<novan-blocks>` gives each block's context `parts` and `tokens` signals, computed from the current
  blocks, so editor updates reach a block without re-creating it. `NovanPart` (selector `[data-novan-part]`, so the
  24a markers are the whole opt-in) and `NovanBlockRoot` (a host directive) bind the classes as separate `[class]`
  sources, which Angular merges with the block's own `hostClasses()`; nothing in the blocks' class logic changed.
  Tokens are a `[style]` binding; the server DOM keeps custom properties. `NOVAN_CLASS_ADAPTER` defaults to the plain
  adapter (base bucket only) until 24c provides a design system's.
- **Blocks:** every block has `hostDirectives: [NovanBlockRoot]` and imports `NovanPart`; `<novan-block-action>`
  imports `NovanPart` for its `action` part. `block-parts.spec.ts` renders every block through `<novan-blocks>` with a
  class on every part and checks each rendered part has its own class only, and that markup is otherwise the same.
- **Cascade layers:** the starter and Laws & Paws sites load the design system and the blocks with `meta.load-css`
  inside `@layer novan-base` (a `@use ... with` cannot sit in a layer), after the layer order statement; the Laws &
  Paws site's own rules are in `novan-base` too. Compiling the old and new stylesheets gives the same rules in the
  same order. The kits have no styles of their own; `docs/clients/new-site.md` says how other sites upgrade.
- **Bridge:** site → admin `parts { uid, parts }` (the selected block's own parts in page order, not those of blocks
  inside it, sent when they change); admin → site `part { uid, part }` draws dotted outlines round every element of
  that part (up to 50).
- **Editor:** a Classes section under Style in the block panel (`nv-class-overrides`): a Part select (the whole block
  first, then the parts the site reported, then any others that hold classes, marked "not on the page"), the classes
  on that part's base bucket in `nv-class-chips`, and Clear buttons. Choosing or editing a part outlines it on the
  page. `nv-class-chips` is a labelled text box with removable chips: Enter adds (several, space-separated),
  Backspace in an empty box removes the last, refusals and changes are announced in a polite live region, and focus
  stays in the box. Breakpoint and state tabs wait for 24c's adapters.
- **E2E:** `apps/admin-e2e/src/class-overrides.spec.ts` (`@classes`): add classes to the hero and its heading, see them
  in the frame, a refused name, Backspace, axe, publish, and the site's server-rendered HTML has the classes.

### 24c

- **Migration `0024_design_systems.sql`:** `design_systems`, `design_system_versions`, `design_system_components`
  (filled in 24d), `design_system_classes` and `space_design_systems` (per environment, one version of each design
  system, `load_order`), all space-scoped with composite same-space foreign keys.
  - Members read; admins and developers (and staff at AAL2) write. The worker's tables and fields are written by the
    service role only.
  - `design_system_versions_guard()`: members insert a version as `uploaded` and nothing else, and only move it
    `uploaded → validating` or `ready → deprecated`. A ready or deprecated version's manifest, files and checksum
    never change, even for the service role.
  - `space_design_systems_guard()`: only a ready version is attached. A deprecated one may stay, because the API
    updates kept rows in place rather than re-inserting them.
  - Private `design-systems` bucket (26 MB cap, stylesheet, script, font, image and JSON types), member read policy
    as `media`; queue `design-systems`.
  - `spaces.settings.designSystems.enabled` is guarded like `media.allowSvg`, exposed as `SpaceSummary.designSystems`
    and switched in Space settings by staff.
  - pgTAP: `supabase/tests/design_systems.test.sql` (31 tests: cross-space reads and writes, roles, the guards, the
    worker-only tables, storage, flags, anon, the queue). The local seed turns design systems on for the demo space.
- **API `libs/api/design-systems`** (`@novan/api-design-systems`):
  - Routes under `v1/management/spaces/:spaceId`:
    - `design-systems` (GET, POST)
    - `design-systems/:id/versions` (POST `{ source: 'css', version, filename }` → signed upload URL, or
      `{ source: 'url', version, url }` → fetched straight away)
    - `.../versions/:versionId` (GET, with its report) and `.../complete`, `.../deprecate`
    - `.../versions/:versionId/classes?q=&group=&limit=` (prefix search, shortest first, and counts per group)
    - `site/design-systems` (GET; PUT the whole ordered list `{ items: [{ versionId, enabled }] }`)
  - Uploads are limited per person (20 versions in ten minutes, `DS_UPLOAD_RATE_LIMIT`, in memory per instance; the
    first throttling on management routes). The feature flag is checked on every write (403 `design_systems_off`).
    Everything is audited (`design_system.created`, `.version_uploaded`, `.version_ready|invalid` from the worker,
    `.version_deprecated`, `design_systems.site_changed`).
  - Changing what the site loads emits `site-styles.changed`, which purges the whole space, like `locales.changed`.
- **Worker** (`design-systems:process-version`, idempotent, only `validating` versions):
  - Reads the pending upload, or fetches the address through `safeFetch`. That is https only; public addresses only,
    checked by a custom DNS lookup at connect time (so DNS rebinding cannot reach private ranges), with IP-literal
    hosts checked before connecting; at most 3 redirects, each re-checked; a 5 MB cap while streaming
    (`DS_MAX_FILE_BYTES`); a 15 s timeout.
  - `processStylesheet` (PostCSS): parse errors with their line; `@charset` dropped; `@namespace` and imports not
    from `allowedOrigins` removed (allowed ones kept with `layer(ds-vendor)`); `behavior`, `-moz-binding` and
    `expression()` removed; each `url()` checked (image and font `data:` URLs and fragments kept, https kept, relative
    ones resolved against a CDN address or refused for uploads, every other scheme removed); `!important` counted
    and warned about. The rest goes inside `@layer ds-vendor`, after the layer order statement, so a stylesheet loaded
    before the site's own cannot change the order.
  - The class index is grouped by the manifest's `classGroups`, else a utility preset (`classGroupOf`). Up to 20,000
    classes are kept. Files go under `files/`, and the version becomes ready or invalid with its report in one
    transaction.
- **Serving:** `GET /v1/design-system-files/:versionId/*path` (no auth) serves only ready or deprecated versions that
  some environment has attached. Paths are plain segments with a known extension. Responses are immutable for a
  year, with `Cache-Tag: design-system:<id>`, CORS `*`, CORP cross-origin, nosniff and a sandbox CSP.
- **Delivery:** Delivery and Preview `GET site-styles` returns `{ layers, stylesheets: [{ href, designSystem,
  version }], adapter }` for the token's environment, tagged `space:` and `site-styles:<env>`. The SDK's proxy passes
  it.
- **Adapters:** `bootstrapAdapter` writes Bootstrap's infix (`px-3` → `px-md-3`, `col` → `col-md`, `text-center`
  → `text-md-center`) for the utility families that have breakpoint versions, and no states. `canWrite(class,
  bucket)` says when a class has no version. `adapterFor()` picks Bootstrap's adapter or the manifest's templates.
  The SDK's copy is held in step as before.
- **SDK:** `NovanDesignSystems` (app initializer in `provideNovanCms`; `designSystems: false` turns it off) fetches
  `site-styles` before the first render, links each stylesheet once in `<head>` (`link[data-novan-ds]`, http(s)
  only, stale ones removed) and sets the adapter. `NOVAN_CLASS_ADAPTER` is now a getter defaulting to that adapter,
  so blocks follow it. An API without the endpoint (404) or an unreachable one leaves the site as it was.
- **Admin:**
  - Settings › Design systems (`settings/design-systems`, admins and developers; linked from the Settings overview
    when the flag is on): what the site loads (move up and down buttons, an on/off switch, remove, add a ready
    version, save, undo); each design system's versions with status badges and the check report (errors open, with
    lines); a new version from a file or an address, polled until checked; deprecate; a class browser (prefix search,
    groups); add a design system (short name suggested from the name).
  - Editor: `EditorClassIndex` (provided by the editor page) loads the site's design systems. The Classes section
    offers an Applies select of the adapter's breakpoints and states (and any bucket already holding classes), and
    the chips input is an ARIA combobox suggesting the design systems' classes. Warnings are written out: a class the
    framework cannot apply at that size, or one no attached design system has.
- **Not in the space nav:** the nav filters by role permission only, not per-space flags, so the page is reached from
  Settings. Changed from the plan.
- **Tests:** `css-processor.spec` (15), `safe-fetch.spec` (27; a public-looking name whose DNS answer is private is
  covered by the connect-time lookup, which needs real DNS to test), `class-groups.spec`, Bootstrap adapter specs, the
  API integration spec `apps/api/src/app/design-systems.spec.ts` (17: roles, the flag, upload → worker → ready with
  report and class search, invalid with line, an SSRF refusal, cross-space 404s, attach rules, files before and
  after attaching, `site-styles`, one version each, deprecation), SDK `site-styles.spec`, admin page and editor
  specs with axe, and the e2e journey `apps/admin-e2e/src/design-systems.spec.ts` (`@design-systems`).

## Definition of done

- [ ] A developer uploads a design system (CSS-only or zip), attaches it, places a custom component on a page, edits
      its props and adds utility classes to any part of any block per breakpoint and state
- [ ] The editor matches the published SSR page
- [ ] Uploaded code cannot affect the admin or another space (tested)
- [ ] Existing pages render unchanged
- [ ] New UI is axe-clean and passes both audits
