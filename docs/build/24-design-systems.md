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

## Definition of done

- [ ] A developer uploads a design system (CSS-only or zip), attaches it, places a custom component on a page, edits
      its props and adds utility classes to any part of any block per breakpoint and state
- [ ] The editor matches the published SSR page
- [ ] Uploaded code cannot affect the admin or another space (tested)
- [ ] Existing pages render unchanged
- [ ] New UI is axe-clean and passes both audits
