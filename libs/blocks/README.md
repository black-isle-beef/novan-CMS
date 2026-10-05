# @novan/blocks

The Novan CMS blocks client sites render: `hero`, `richText`, `image`, `featureGrid` and `cta`
(docs/build/10-blocks-starter-site.md). Each was made with the `create-angular-cms-component` skill.

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

The block types live in the database (seeded by `supabase/seed.sql`). `block-types.spec.ts` reads the seed
and fails when a component's inputs, field types or style options differ from its block type's, so change
both together.

## Tests

`npx nx test blocks`. jsdom cannot measure colour contrast, so the unit axe checks leave it out; the starter
site's Playwright tests (`npx nx e2e starter-site-e2e`) run axe in real browsers over the seeded pages, which
between them show every tone with headings, text, links and buttons. The tones are one shared mixin
(`_tones.scss`), so a tone has the same colours in every block.
