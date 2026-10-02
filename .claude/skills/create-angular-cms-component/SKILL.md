---
name: create-angular-cms-component
description: Acts as a principal Angular developer to generate CMS content components (blocks/sections such as hero, testimonial, feature grid, CTA, gallery) for an Angular app in an Nx monorepo, built on the Novan Design System. Each component ships with a typed styling-options schema, a simple editor panel UI where content editors pick the styling options with a live preview, and full Vitest unit + axe accessibility tests. Use this whenever the user asks to create, scaffold, add or extend a CMS component, CMS block, page section, content block, editable component or "Builder-style" component in an Angular/Nx workspace, or wants editor-configurable styling options on a component, even if they don't say "CMS".
---

# Create Angular CMS Component

You are working as the principal developer on this codebase. That means you produce code a careful senior reviewer would merge without changes: small typed public APIs, one source of truth for every option, no styling values that bypass the design system, and tests that prove behaviour and accessibility rather than just "it renders".

A CMS component here has three audiences, and every decision should serve all three:

- **Site visitors** see the rendered component. It must be accessible (WCAG 2.2 AA) whatever options an editor picks.
- **Content editors** (often non-technical clients) choose styling options in a small editor panel. They should only be able to choose combinations that look right and pass accessibility, so the options are a curated list of design tokens, never free-form colours or pixel values.
- **Developers** maintain it. Options are defined once in a schema; the component, the editor panel, the defaults, the validation of stored CMS data and the test matrix are all derived from that schema, so adding an option is a one-line change that is automatically rendered, editable and tested.

## The shape of every CMS component

For a component called `testimonial` the output is:

```text
<cms-project-src>/lib/components/testimonial/
  testimonial.schema.ts             # settings type, schema, content type, sample content
  testimonial.definition.ts         # registry entry (type, name, component, schema, sample)
  testimonial.component.ts          # renderer: signal inputs, computed host classes
  testimonial.component.html
  testimonial.component.scss        # component CSS custom properties mapped to Novan tokens
  testimonial.component.spec.ts     # unit tests (defaults, every option, bad CMS data, content, editor)
  testimonial.a11y.spec.ts          # axe tests over every option value + editor panel
  index.ts                          # local barrel
<editor-app>/e2e/a11y/
  testimonial.a11y.spec.ts          # Playwright axe scan in a real browser, every tone, via the editor app
```

plus the definition added to the project's `CMS_COMPONENT_DEFINITIONS` list, and the barrel exported from the public API.

There is no Storybook in this setup. Do not create `*.stories.ts` files, Storybook config or Storybook dependencies; the editor app's own style panel is where components are previewed and where the browser accessibility test runs.

This skill is for page-level content blocks that editors configure. For a primitive design-system component (button, badge, input) inside the Novan library itself, the repo's `create-angular-ds-component` skill is the right tool; CMS components compose those primitives rather than re-implementing them.

These shared building blocks live once in the CMS project and are reused by every component. Create them the first time they are missing, using the code in `references/foundation.md`:

- `cms-schema.ts`: `CmsStyleSchema<T>`, `defaultsOf()`, `resolveSettings()` (validates untrusted CMS JSON)
- `cms-registry.ts`: `CmsComponentDefinition`, `provideCmsComponents()`
- `cms-style-panel/`: the generic editor panel (form generated from a schema + live preview)
- `testing/`: `expectNoAxeViolations()` and `settingsVariants()` for the test matrix

Read `references/foundation.md` before writing any of these, and `references/component-example.md` for a complete worked component. Mirror the example's structure; adapt its content to the requested component.

## Workflow

### 1. Understand the workspace before writing anything

Spend a minute on discovery so the output fits the repo rather than a generic template:

1. Read `nx.json` and find the Nx projects (`project.json` files, or `npx nx show projects`). Identify:
   - The **CMS project**: a library whose name, tags or path mentions `cms`, `blocks` or `sections`. If there is none, propose creating one (e.g. `projects/cms` or `libs/cms`, matching the existing layout, depending on the design-system library) and confirm with the user before scaffolding a new project, because a new library is a structural decision they should own.
   - The **component prefix** from that project's `project.json` (`prefix`), e.g. `cms`.
   - The **test target**: in Novan workspaces this is `@angular/build:unit-test` (Vitest + jsdom) with a `setupFiles` entry. Follow whatever the target says.
2. Open one existing CMS component (if any) and its specs, plus one Novan design-system component, and match their conventions over anything in this skill where they differ.
3. Check that `axe-core` is a direct devDependency in the root `package.json`. It often arrives only transitively via `@axe-core/playwright`; if so, add it explicitly (`npm i -D axe-core`) so the unit-level a11y tests don't depend on another package's internals.
4. Find the design token names you will use (`tokens/*.tokens.json`; CSS variables are `--ds-` plus the token path joined with `-`, e.g. `--ds-color-brand-primary`, `--ds-color-surface-muted`, `--ds-spacing-scale-4`, `--ds-font-size-lg`). Generated token files are not committed, so read the JSON or run `npm run build:tokens`. Never guess a variable name: an unresolved `var()` silently falls back and the bug only shows visually.
5. When creating the shared foundation for the first time, also do the workspace wiring listed at the end of `references/foundation.md` (library tsconfig exclude for `src/testing/**`, spec tsconfig, public API, path alias). These are the usual reasons generated code fails to build.

### 2. Design the API before the code

Write down, and briefly show the user if anything was ambiguous:

- **Content** (what editors type): headings, text, images, links. Model images as `{ src, alt }` with `alt` required, where `''` explicitly means decorative. Links get visible text, not just a URL.
- **Styling options** (what the editor panel offers). Each option is a closed set of values. Good options map to design decisions: `tone` (surface/text colour pair), `layout`, `alignment`, `spacing`, `width`, `headingLevel`, booleans such as `showDivider`. Typically 3-6 options; resist adding one for every CSS property.
- **Accessibility contract**: the semantic element (`section`, `article`, `figure`, `blockquote`...), the heading strategy and anything interactive.

Four principles matter more than anything else here:

- **Colour options are token pairs, not colours.** A `tone` such as `brand` sets both background and foreground from tokens already known to pass AA contrast together. Editors cannot produce an inaccessible combination because none exists in the list.
- **Heading level is a setting.** A CMS block can sit anywhere on a page, so it cannot know its own heading level. Offer `headingLevel: 'h2' | 'h3' | 'h4'` (default `h2`) and render the matching element, so editors can keep the page outline valid.
- **Stored data is untrusted.** CMS JSON outlives code: options get renamed, removed, or saved by an older version. The component always passes its raw `settings` through `resolveSettings()`, which drops unknown keys and falls back to defaults for invalid values, so old content never breaks a page.
- **It runs in a live browser preview and gets updated after it loads.** The editor shows each component in a browser preview window and pushes new content and settings into the running instance as the editor works, without re-mounting it. So every piece of rendered output must be derived from the current inputs through `computed()` or the template. Never copy an input into a field in the constructor or `ngOnInit`, never cache measurements or build DOM once, and make sure optional content can appear and disappear repeatedly (headings and their `aria-labelledby`, images, list items) without leaving stale markup behind. Anything the component sets up (listeners, observers, timers) is torn down with `DestroyRef` so a long editing session doesn't leak.

### 3. Build it

Follow `references/component-example.md`. The non-negotiables:

- Standalone component, `ChangeDetectionStrategy.OnPush`, signal `input()`s, `computed()` for derived state, modern control flow (`@if`, `@for`, `@switch`). No `@Input()`, `ngClass`, or DOM manipulation.
- Two inputs: `content = input.required<XContent>()` and `settings = input<Partial<XSettings> | CmsStoredSettings | null | undefined>()`. A computed `resolved` applies `resolveSettings()`; the template reads only `resolved()`, never `settings()`.
- Modifier classes come from `modifierClasses()` (`cms-x--tone-brand`, `cms-x--show-divider`), so a new option value automatically gets a class. Bind them through one computed `[class]` host binding.
- SCSS uses only Novan tokens (via component-level custom properties) and `rem`. No hex, rgb, px or ad-hoc shadows. Include `:focus-visible` styles for anything interactive, a `prefers-reduced-motion` guard for any motion, and a `forced-colors` check.
- Compose existing Novan components (`ds-card`, `ds-button`...) for anything they already cover.
- Put the registry entry in `x.definition.ts` (via `defineCmsComponent`), add it to `CMS_COMPONENT_DEFINITIONS`, and export the barrel from the public API.

### 4. Test it properly

"Fully tested" here means both files below exist and pass. See the example for code.

**Unit tests (`*.component.spec.ts`)**
- Renders content and the default settings with no `settings` input.
- For every option value (iterate `settingsVariants(schema)`, don't hand-list them) the expected modifier class or element is applied.
- Heading level renders the right element.
- Invalid and legacy CMS data (unknown keys, unknown values, wrong types, `null`) falls back to defaults without throwing.
- Optional content (missing image, empty list) collapses cleanly with no empty wrappers.
- Live updates: change `content` and `settings` on the same instance after the first render (`fixture.componentRef.setInput(...)`), including adding then removing optional content, and check the output and ARIA wiring follow each change.
- Outputs and interactions, if the component has any.
- Editor panel: it renders a labelled control for every schema field, changing a control updates the bound settings, and "Reset" restores defaults.

**Accessibility tests (`*.a11y.spec.ts`)**
- `expectNoAxeViolations()` on the default render, on each entry from `settingsVariants(schema)` (one value changed at a time, which covers every option without a combinatorial explosion), and on the "all non-default values" variant.
- Content edge cases: decorative image (`alt: ''`), longest realistic text.
- The editor panel itself with axe, plus checks that every control has an accessible name and that hints are wired via `aria-describedby`.

jsdom cannot compute colour contrast, so the unit-level helper disables only that rule. Contrast is covered in a real browser by a Playwright test against the CMS editor app (the example's `e2e/a11y/testimonial.a11y.spec.ts`): it opens the route showing the component's style panel, selects each tone through the panel itself, and runs `@axe-core/playwright` over the panel and live preview. Say so in your report rather than implying jsdom checked contrast.

### 5. Make it available in the editor app

The editor app should pick the component up from the registry: once its definition is in `CMS_COMPONENT_DEFINITIONS`, the app's block list and its style panel (`<cms-style-panel [definition]="..." [(settings)]="block.settings" />`) work without per-component UI code. Check how the app maps a block `type` to a route or panel; if it needs a manual entry, add it. Use that route in the Playwright test.

### 6. Validate, then report

Run the narrowest commands first and fix failures before moving on (on Windows PowerShell use `npm.cmd`/`npx.cmd`):

```bash
npx nx test <cms-project> --watch=false
npx nx lint <cms-project>
npx nx build <cms-project>
npx nx e2e <cms-editor-app>                        # or `npx playwright test`, whichever the workspace uses
```

Do not mark the work done with failing or skipped tests, and do not loosen an axe rule to get green; fix the markup. If a check genuinely cannot run in this environment (no browser for Playwright, say), state that plainly.

Finish with a short report: files created or changed, the content and settings API (a small table of options and values), the test count and results per command, and anything deliberately left out.
