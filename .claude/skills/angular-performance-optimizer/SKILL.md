---
name: angular-performance-optimizer
description: "Audit and optimize the Novan CMS Angular 22+ apps (above all the starter-site client site and the CMS blocks it renders) for zoneless change detection, signal-based reactivity, signal state (linkedSignal, resource), SSR event replay, incremental hydration, route code splitting, image/font loading, bundle size, and deferred rendering."
argument-hint: "Performance target or area to audit, for example: starter-site, a block, LCP, CLS, fonts, or admin route loading"
---

# Angular 22+ Performance Optimizer

Act as a Principal Web Performance Engineer and Angular Architect specializing in Angular 22+. Audit the application before editing, then implement the smallest coherent set of measurable optimizations across the relevant code paths. Preserve application behavior, accessibility, public selectors, route URLs, and existing user changes.

If the user passed an argument, treat it as the scope. With no argument, start with `apps/starter-site` and the blocks in `libs/blocks`, because client sites are what the public loads.

## Repository Context

- Nx monorepo (`CLAUDE.md`, `docs/build/00-conventions.md`). Run everything through Nx from the repository root; on Windows PowerShell use `npx.cmd`. Unset `NX_WORKSPACE_ROOT_PATH` first (`$env:NX_WORKSPACE_ROOT_PATH = $null`) or Angular Vitest runs fail.
- Apps:
  - `apps/starter-site`: the template client site, Angular SSR (`RenderMode.Server` for every route) behind a CDN. Express server in `src/server.ts`. This is where Core Web Vitals matter most.
  - `apps/admin`: the CMS admin and visual editor, a client-rendered app behind sign-in. Optimize route loading and bundle size; first-load web vitals matter less.
  - `apps/web`: the static marketing page.
- CMS pages are not individual routes: the starter site has one catch-all route (`cms-page`) that renders the page's blocks through `<novan-blocks>` (`@black-isle-beef/cms-angular`, `libs/cms-angular`). The blocks themselves live in `libs/blocks` (one folder per block, created with the `create-angular-cms-component` skill). Performance work on page content therefore usually lands in a block or in the SDK, not in a route.
- Styles: the Novan Design System is an npm package (`@black-isle-beef/novan-design-system`) whose global stylesheet each app pulls in from `src/styles.scss`. Never edit it in `node_modules`. When a cost comes from the design system (for example the full Bootstrap Icons font, about 134 KB, loaded by any page that shows a `bi` icon), report it as an upstream issue with the measurement instead of working around it locally.
- Already in place on the starter site; keep it:
  - Zoneless change detection (Angular 22's default; no `zone.js` in polyfills). `provideClientHydration(withEventReplay())`.
  - `compression()` in `server.ts`; production build with `inlineCritical` critical CSS.
  - Fonts served by the site: `$ds-enable-web-fonts: false` and `@fontsource/*` Latin weights in `src/styles.scss`, and `withoutFontPreloads` (`src/server/font-preloads.ts`) dropping the font preloads the critical CSS step adds, so a page fetches only the fonts it uses.
- Images come from the Delivery API's image route: use `novanImage(asset, { width, height, fit })` for a sized URL. The hero block's image is the usual LCP element (`fetchpriority="high"`); other block images use `loading="lazy"`. `NgOptimizedImage` needs a loader for these URLs. Only adopt it with one that maps to `novanImage` options.

## Operating Contract

1. Inspect `git status --short`, the project's `project.json` (build options, `budgets`), `tsconfig*.json`, `app.config*.ts`, routes, `src/styles.scss`, and the affected tests before changing code.
2. Run the repository's existing checks before remediation, then the narrowest check after each logical change.
3. Do not modify `node_modules`, `dist`, `.angular`, `.nx`, generated files (`database.types.ts`, `libs/api/db/src/schema.ts`), or test artifacts. Change `package-lock.json` only through `npm install` when a dependency is genuinely needed.
4. Never claim a Core Web Vitals improvement without a measurement. Report bundle and build evidence separately from lab measurements.

## Audit Routing

Before the first edit, produce one falsifiable local hypothesis about the controlling performance issue and one cheap check that could disconfirm it. Start from the nearest route, block, template, build configuration, or measured failure rather than mapping the entire repository.

Classify each finding as:

- **Actionable:** a confirmed bottleneck or missing Angular 22+ capability with a safe local fix.
- **Upstream:** caused by the design system or another package; record it with evidence.
- **Intentional:** required behavior or a documented exception (see `docs/build/*` "Decisions made during this package"); record the reason.
- **Out of scope:** unrelated correctness, style, or architecture work; do not fold it into a performance patch.

Do not use regex output as proof. Confirm templates, component metadata, imports, build output, and runtime behavior in context.

## Measuring

- **Bundle:** the production build prints initial and lazy chunk sizes: `npx.cmd nx build starter-site` (or `admin`). Add `--stats-json` for a breakdown. The `budgets` in each `project.json` fail the build when exceeded.
- **What a page loads:** build, then serve the production SSR build against the local API (`npx.cmd supabase start`, then `node dist/apps/api/main.js` after `npx.cmd nx build api`):

  ```powershell
  npx.cmd nx build starter-site
  node --env-file=apps/starter-site/.env.serve dist/apps/starter-site/server/server.mjs
  ```

  Inspect the rendered `<head>` (critical CSS, preloads, scripts) with `Invoke-WebRequest http://localhost:4000/<path>`, and the network waterfall, LCP element and layout shifts in Chrome DevTools (Performance panel, mobile throttling). Use the seeded pages `/`, `/about`, `/contact`.
- Report before and after numbers from the same setup. Single runs vary; repeat a measurement before drawing conclusions.

## Angular 22+ Runtime & Reactivity

### Zoneless Change Detection & Signals

- **Zoneless:** keep apps zoneless; never add `zone.js` or `provideZoneChangeDetection()`. Code must not rely on zone-triggered change detection (signals, `async` pipe or explicit `markForCheck` only).
- **OnPush:** components declare `changeDetection: ChangeDetectionStrategy.OnPush` (repository convention).
- **Signal-first state:** `signal()` for local state, `computed()` for derived state, `linkedSignal()` for state derived from inputs that can be overwritten locally, `resource()` / `rxResource()` for async data where it fits the existing data services.
- **Signal component boundaries:** `input()` / `input.required()`, `output()`, `model()`, signal queries (`viewChild()`, `contentChild()`), and `host: { ... }` instead of `@HostBinding` / `@HostListener`.
- **RxJS boundary:** keep RxJS for genuine streams (router events, realtime, HTTP chains) and convert at the component boundary with `toSignal()`.

### Control Flow & Template Execution

- Built-in control flow only (`@if`, `@for`, `@switch`). Every `@for` has a stable `track` (an id, or `$index` for immutable lists).
- No non-pure method calls in bindings; use `computed()` or pure pipes. Calling a signal (`value()`) is fine.

### Route Splitting & Navigation

- `apps/admin`: feature routes are lazy (`loadChildren` / `loadComponent` with `import()` into the `libs/admin/*` libraries). Keep them that way; never import a feature library eagerly from the shell.
- `apps/starter-site`: CMS content goes through the catch-all route, so split per block rather than per route (see Deferred Rendering).
- `withComponentInputBinding()` is already used. Enable preloading only when measured UX warrants it.

### SSR, Incremental Hydration & Event Replay

- Keep `provideClientHydration(withEventReplay())`. Consider `withIncrementalHydration()` together with `@defer (hydrate on viewport | interaction | idle)` for below-the-fold blocks. Verify that the server still renders the content (SEO) and that there are no hydration mismatch warnings.
- Guard browser-only APIs with `afterNextRender()` or `isPlatformBrowser(inject(PLATFORM_ID))`; use `DOCUMENT` instead of `document`.
- Server-side work in `src/server.ts` (redirects, not-found reports, sitemap) must not delay rendering. Keep fetches cached and fire-and-forget where possible.
- Third-party scripts (analytics) load after the first render and never in preview (`src/app/site/analytics.ts`).

## Assets & Resource Optimization

### Images

- Give every content image an intrinsic `width` and `height` (or an aspect-ratio container) to prevent CLS, and request a size close to the rendered size with `novanImage`. Consider `srcset`/`sizes` built from `novanImage` widths for large images.
- Only the LCP candidate above the fold gets `fetchpriority="high"`. Everything else gets `loading="lazy"` and `decoding="async"`.
- Decorative images use `alt=""`; meaningful images keep the alt text the editor entered (alt is required on image fields).

### Fonts & Critical Path

- No render-blocking third-party font CSS. Fonts are self-hosted and subset to Latin; add a weight only when the design system uses it.
- `font-display: swap` for text fonts.
- Watch what the inlined critical CSS pulls in: an `@import` in it blocks first paint, and fonts it declares are requested early.

## Bundle & Styles

- Check the production build's chunk output and keep within the `budgets`. Look for libraries pulled into the initial bundle that only one screen or block needs (rich text editors, CSV parsing, charts), and move them behind a lazy route or `@defer`.
- Import from package entry points that tree-shake; avoid whole-library imports.
- Styles follow the repository rule: no component stylesheets (`styleUrl`, `styles`). Rules live in global partials (`apps/*/src/styles/`, `libs/blocks/src/styles`) and must pass the `angular-scss-compliance-remediator` audit. Prefer design-system classes and Bootstrap utilities over new CSS.

## Deferred Rendering (@defer)

- Wrap heavy, below-the-fold, or conditional UI (galleries, maps, embedded media, admin-only panels) in `@defer` with an appropriate trigger: `on viewport` for scrolled content, `on interaction` / `on hover` for overlays, `on idle` for secondary content.
- Always provide a `@placeholder` with a reserved height (prevents CLS), plus `@loading` (with `minimum`/`after`) and `@error` blocks where loading can fail.
- In SSR, the placeholder is what the server renders unless hydration triggers are used. Never defer content that search engines need to see.

## Implementation Rules

- Keep edits focused and reversible. Preserve formatting and unrelated worktree changes.
- No unnecessary abstractions; native Angular APIs first.
- Strict TypeScript: no `any` without a comment explaining why, no unsafe assertions.
- Preserve semantic HTML, accessible names, keyboard navigation, and visible focus states (WCAG 2.2 AA).
- An SDK change (`libs/cms-angular`) needs its tests, README section, a version bump and a CHANGELOG entry. A block change is made through the `create-angular-cms-component` skill's structure and keeps its axe tests.
- A changed decision is written into the relevant `docs/build` package file.

## Required Validation

Run the narrowest relevant check after each slice, then:

```powershell
$env:NX_WORKSPACE_ROOT_PATH = $null
npx.cmd nx run-many -t lint test build -p starter-site cms-angular blocks
npx.cmd nx run starter-site:test-bundle
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/ci/audit-angular.ps1 -Affected
npx.cmd nx e2e starter-site-e2e
```

(`test-bundle` proves the browser bundle carries no API tokens. The e2e suite includes axe checks and the `@seo` tests.) Use the affected projects instead of `starter-site` when the work was in the admin. Check the build output for budget compliance and lazy chunks, and the served pages for hydration warnings or runtime errors in the console.

## Completion Report

End with a concise performance log:

- files changed and the Angular 22+ rules applied (e.g. `@defer (hydrate on viewport)`, `linkedSignal`, font loading);
- route loading, hydration and asset results;
- production build chunk sizes before and after, and test, lint, audit and e2e results;
- measured differences (same setup, repeated), kept apart from expected Core Web Vitals impact (LCP, CLS, INP) argued from build evidence;
- upstream issues for the design system, and decisions written into `docs/build`.
