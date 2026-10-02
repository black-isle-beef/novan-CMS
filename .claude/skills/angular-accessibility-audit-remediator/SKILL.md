---
name: angular-accessibility-audit-remediator
description: "Use when auditing and fixing accessibility in the Novan CMS Angular apps, including semantic HTML, ARIA, keyboard interaction, focus management, contrast, rendered Axe checks, and accessible use of design-system components."
---

# Angular Accessibility Audit and Remediation

Act as a Principal Accessibility Engineer for the Novan CMS Angular applications. Perform a full accessibility audit, fix confirmed failures in the repository, and verify the repaired experience. Work directly in the codebase; do not merely propose patches.

If the user passed an argument, treat it as the audit scope (an app, a route, or a component). With no argument, audit every route of every app under `apps/`.

Automated checks are necessary but incomplete. A clean Axe run is not proof of WCAG conformance. Combine static inspection, rendered Axe scans, keyboard checks, and a review of component states.

## Repository Context

- This is an Nx workspace. Applications live under `apps/` (currently `apps/web`, routes in `apps/web/src/app/app.routes.ts`); shared libraries, if added, live under `libs/`.
- UI is composed from `@black-isle-beef/novan-design-system` (`ds-header`, `ds-hero`, `ds-footer`, …), consumed as an npm package, with global styles from each app's `src/styles.scss`.
- Never edit the design system inside `node_modules`. When a failure originates inside a design-system component or its styles, verify it, then report it as an upstream issue for the design-system repository (component, state, rule, and reproduction). Fix locally only what the app controls: the inputs, projected content, and surrounding markup it passes in.
- There are no npm scripts, Storybook, or Playwright suite in this repo. Run targets through Nx; on Windows PowerShell use `npx.cmd` (for example `npx.cmd nx serve web`, `npx.cmd nx test web`, `npx.cmd nx build web`).

## Guardrails

- Inspect the current worktree before editing. Preserve unrelated user changes and do not modify `node_modules`, `dist`, `.angular`, or `.nx`.
- Use the Edit tool for source edits. Do not use broad search-and-replace or regex-only transformations that can alter Angular template semantics.
- Keep public selectors, component inputs/outputs, routes, visible labels, and behavior stable unless accessibility requires a deliberate, reported change.
- Fix root causes rather than suppressing Axe rules, adding invalid ARIA, removing focus outlines, or using `aria-hidden` to conceal meaningful content.
- Do not invent alt text, labels, legal copy, or product claims. For an ambiguous image or icon, identify the product decision required and make only safe code changes.
- Do not add new dependencies (for example Playwright or `@axe-core/playwright`) without asking the user first.
- Audit one logical page or component slice at a time. After the first substantive edit, run the narrowest validation that can disprove the fix before touching another slice.
- Treat static matches and automated violations as evidence, not proof. Verify every finding in source and rendered context; record false positives and intentional exceptions.

## Step 1: Establish the Baseline

1. Inspect `git status --short` and identify user changes to preserve.
2. Read the routes, page/component templates and TypeScript, and any unit tests before editing.
3. Serve the app from the repository root (run it in the background; it listens on `http://localhost:4200` by default):

```powershell
npx.cmd nx serve web
```

4. Run Axe against every route in a real browser. Use an available browser tool (built-in browser or Claude in Chrome) to load each route and inject `axe-core` from `https://cdnjs.cloudflare.com/ajax/libs/axe-core/<version>/axe.min.js`, then run `axe.run()`. If no browser tool is available, tell the user and propose adding Playwright with `@axe-core/playwright` as a dev dependency; do not install it without approval.
5. Capture every Axe violation with its rule ID, impact, affected route, target, and help text. Do not truncate the output. Note which violations come from design-system internals versus app markup.
6. Run static searches for likely issues, then inspect every match in context. Examples:

```powershell
rg -n "\*ngIf|\*ngFor|\*ngSwitch|\(click\)=|tabindex=|role=|aria-|<img|<button|<a\b|<input|<select|<textarea" apps libs
rg -n "outline:\s*(0|none)|user-select:\s*none|pointer-events:\s*none" apps libs
```

7. Categorize confirmed findings under: semantics and landmarks; names, roles, and values; keyboard interaction; focus and dialogs; visual contrast and non-color cues; forms and error messaging; media; responsive and zoom behavior; and test coverage.

Before editing, report the count per category, the affected routes/components, upstream design-system issues, and all false positives or intentional exceptions.

## Step 2: Audit Every Page and State

For each route and app component, inspect the default render plus every meaningful state: responsive breakpoints, open/closed navigation, expanded/collapsed regions, loading, empty, error, and disabled states, and every piece of content projected into design-system components. A state that cannot be reached in the running app should be reproduced in a unit test.

Verify each of the following:

### Semantics and landmarks

- Use native `button`, `a`, `input`, `select`, `textarea`, `label`, `nav`, `main`, `header`, `footer`, `section`, `article`, `dialog`, and list elements when they model the interaction.
- Do not add ARIA roles that duplicate or conflict with native semantics. Prefer a native element over `role="button"`, `role="link"`, or manual keyboard handlers.
- Give every page one coherent landmark structure with exactly one `main`, and keep the design-system skip link target (`#ds-main-content`) on it. Label multiple landmarks of the same type.
- Preserve logical heading order across the page, including headings rendered by design-system components (for example the hero heading). Do not select a heading level only for its visual style.

### Accessible names, roles, and states

- Ensure every interactive control has an accessible name from visible text, an associated `<label>`, `aria-label`, or `aria-labelledby`.
- Use concise, accurate alternative text for meaningful images; use `alt=""` for decorative images. Mark decorative icon elements (for example Bootstrap Icons `<i class="bi …">`) with `aria-hidden="true"`, and give icon-only controls an accessible name.
- Bind dynamic ARIA state directly to Angular signals. Do not stringify or duplicate state in imperative DOM code.

```ts
@Component({
  selector: 'app-faq-item',
  templateUrl: './faq-item.html',
})
export class FaqItem {
  readonly disabled = input(false);
  protected readonly expanded = signal(false);
  protected readonly panelId = `faq-panel-${nextId++}`;
}
```

```html
<button
  type="button"
  [attr.aria-expanded]="expanded()"
  [attr.aria-controls]="panelId"
  [disabled]="disabled()"
  (click)="expanded.update((value) => !value)"
>
  <ng-content select="[faqQuestion]"></ng-content>
</button>
@if (expanded()) {
  <section [id]="panelId"><ng-content></ng-content></section>
}
```

- Use `aria-busy` only while a region is genuinely loading. Pair a meaningful loading announcement with appropriate live-region behavior when the update is not otherwise obvious.
- Do not use `aria-label` to override clear visible text with different wording.

### Keyboard and focus

- Verify Tab and Shift+Tab order follows visual and DOM order without keyboard traps, and that the skip link works.
- Verify native controls retain their standard Enter and Space behaviors. Custom widgets must implement the relevant WAI-ARIA keyboard pattern completely, including Escape, arrow keys, Home, and End where required.
- Use `:focus-visible` for a visible focus indicator. Never remove the outline without a token-driven replacement of equal or better visibility.
- On route changes, move focus or announce the new page so screen-reader users know navigation happened. For dialogs, menus, and disclosures, retain focus appropriately while open and restore it to the invoking control on close.
- Do not make a non-interactive element focusable merely to satisfy a test.

### Visual and responsive access

- Check default, hover, focus, active, disabled, error, and selected states. Never make color the only indicator of status or validation.
- Use design-system tokens (`var(--ds-*)`) or Bootstrap variables for foregrounds, backgrounds, borders, and focus rings. Do not introduce raw colors to work around contrast failures; if a token itself fails contrast, report it upstream.
- Preserve content and operability at 200% browser zoom, with text spacing overrides, narrow viewports, reduced motion, and Windows forced-colors mode where applicable.
- Keep touch targets practical and ensure labels do not overlap or clip at responsive breakpoints.
- Respect `prefers-reduced-motion` for nonessential animations and transitions.

### Forms and errors

- Associate each control with a visible label. Use `for` and `id` for native form fields; do not depend on placeholder text as a label.
- Connect help text and validation errors through `aria-describedby` only when that relationship is useful.
- Identify invalid values with `aria-invalid` and an accessible error message. Announce asynchronous validation or submission results when users need notification.
- Retain user-entered values and focus location when validation fails unless the interaction pattern requires a different outcome.

## Step 3: Implement Behavior-Preserving Fixes

Apply fixes in dependency order: app-wide styles and layout, shared app components, then individual pages and states.

1. Make the smallest semantic, template, TypeScript, SCSS, or test update necessary to correct one confirmed issue.
2. Use standalone Angular APIs and signals for new or updated component state. Keep template bindings declarative.
3. Add or update a focused unit test (Vitest via `@angular/build:unit-test`) for rendered semantic elements, signals driving ARIA state, emitted events, and focus behavior where applicable. Query by role and accessible name rather than CSS classes where practical.
4. Do not add redundant ARIA attributes merely because an audit is quiet. Use `role="status"`, `role="alert"`, `aria-live`, or `aria-modal` only when the behavioral contract actually needs them.

## Step 4: Focused Verification Loop

After each logical slice, validate before expanding scope:

1. Run the project's unit tests:

```powershell
npx.cmd nx test web
```

2. With the dev server running, reload the affected route, rerun Axe, and repeat the keyboard checks for the changed behavior.
3. Verify the previous violation is gone without introducing regressions.

If a fix fails, repair the same slice and rerun the same focused check. Do not proceed to unrelated components while it is failing.

## Step 5: Full Validation

When all confirmed issues are fixed, run these from the repository root:

```powershell
npx.cmd nx run-many -t test
npx.cmd nx run-many -t build
```

Then rerun Axe across every route. If a command fails for a pre-existing unrelated reason, report it precisely with the owning file or configuration and do not claim that validation passed.

## Required Completion Output

Report findings first, ordered by severity. Then provide a concise file-by-file change report with the violation category, behavior-preserving fix, and focused validation for each affected file.

Finish with:

- baseline and final counts by accessibility category;
- every remaining finding, false positive, and intentional exception;
- issues that belong upstream in the design-system repository;
- unit test, build, and rendered Axe results;
- explicit product decisions that could not be safely inferred.

Never claim full WCAG conformance based only on automated tools. State the scope actually tested, including the routes, browser, viewport conditions, and manual keyboard checks performed.
