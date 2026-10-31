# @novan/blocks

The Novan CMS blocks client sites render: `hero`, `richText`, `image`, `featureGrid`, `cta` and `form`
(docs/build/10-blocks-starter-site.md, 18), `listing`, the newest blog posts or projects of the blog and portfolio
starter kits (docs/build/19-schema-cli-starter-kits.md), and `mediaText` (an image beside text), `cardGrid` (photo
cards) and `badgeList` (short labels such as qualifications), added for the pilot client
(docs/build/15-pilot-launch.md). No starter kit uses those three yet: a site adds them with `novan blocks sync <name>`
and lists them in its page type's `allowedBlocks`. Each was made with the `create-angular-cms-component` skill.

`customHtml` takes hand-written markup and CSS. The markup goes through Angular's HTML sanitiser (no scripts, event
handlers, frames, forms, ids or `style` attributes). The CSS is scoped to the block (`[data-novan-custom-html="<_uid>"]`,
with `&` for the block itself) in the `novan-overrides` layer. On published pages it comes from the site's stylesheet,
`GET /v1/site-css/:environmentId/blocks.css`, which Delivery `site-styles` lists so the SDK links it in `<head>`. The
API cleans it as it cleans uploaded stylesheets and removes at-rules that cannot be nested (`@import`, `@font-face`,
`@keyframes`). In preview the block adds its current CSS to `<head>` itself, so the editor sees changes before they
are published.

## Use in a site

```ts
// app.config.ts
provideNovanCms({ blocks: novanBlocks });
```

```scss
// styles.scss, after the design system. Add `libs/blocks/src/styles` to the build's
// `stylePreprocessorOptions.includePaths`.
@use '@black-isle-beef/novan-design-system/styles/styles';
@use 'novan-blocks';
```

Blocks have no component stylesheets: their styles are global partials in `src/styles`, as the repo's SCSS
audit requires. Spacing comes from the design system's Sass tokens (`$ds-spacing-scale-*`) and colours from
its custom properties (`--ds-color-*`); `starter-site:test-bundle` fails if a partial uses a custom property
the built stylesheet does not declare globally.

## How a block is put together

`src/lib/components/<block>/`:

| File | What it holds |
| --- | --- |
| `<block>.schema.ts` | The field values interface, the style options (`CmsStyleSchema`) and sample content |
| `<block>.component.ts` | The component: one `input()` per field, a `settings` input, `static novanBlock` |
| `<block>.definition.ts` | Its entry in `CMS_COMPONENT_DEFINITIONS`: type, name, field types, style options, sample |
| `*.component.spec.ts` | Content, every style option, stored data that is old or invalid, live updates, editor panel |
| `*.a11y.spec.ts` | axe (WCAG 2.2 AA) over every style option, edge-case content and the editor panel |

`<novan-blocks>` sets a block's fields on the inputs of the same name and its chosen style options (`_style`)
on `settings`. The component passes `settings` through `resolveSettings()`, so unknown or retired values fall
back to the defaults and old pages keep rendering.

`CmsStylePanelComponent` (`<novan-style-panel>`) is the editor panel: a form generated from a block's style
options with a live preview.

## Keeping blocks and block types in step

`block-types.json` is every block as a block type: name, icon, preview image, field definitions and style options.
It ships with the package (`@novan/blocks/block-types.json`), and `novan blocks sync` pushes it to spaces
(tools/novan-cli). `block-types.spec.ts` fails when a component's inputs, field types or style options differ from
its entry there, and when `supabase/seed.sql` seeds a block type differently, so change all three together. The
starter kits copy the entries they use (`kits/*/schema/block-types`), and the CLI's `kits.spec.ts` keeps them equal.

## Tests

`npx nx test blocks`. jsdom cannot measure colour contrast, so the unit axe checks leave it out; the starter
site's Playwright tests (`npx nx e2e starter-site-e2e`) run axe in real browsers over the seeded pages, which
between them show every tone with headings, text, links and buttons. The demo space has no blog, so `listing.spec.ts` adds
the blog kit's `post` type and the `listing` block for its run and shows the listing in every tone. The tones are one shared mixin
(`_tones.scss`), so a tone has the same colours in every block.
