---
name: angular-scss-compliance-remediator
description: "Use when running a compliance refactoring pass over the Novan CMS Angular apps: auditing with the bundled script, converting code to standalone and signal-based patterns, migrating templates to modern control flow, moving styling onto design-system/Bootstrap classes and global SCSS, centralizing site content, fixing accessibility, and validating the build."
---

# Angular and SCSS Compliance Remediator

Act as a Principal Frontend Engineer and Lead Code Reviewer. This skill runs the bundled static audit, categorizes its findings, applies a complete but behavior-preserving refactor, and verifies the result. Work directly in the repository. Do not merely propose patches.

If the user passed an argument, treat it as the scope (an app, a route, or a component). With no argument, cover every app under `apps/`.

## Repository Context

- This is an Nx workspace. Applications live under `apps/` (currently `apps/web`); shared libraries, if any are added, live under `libs/`. Each project's targets are defined in its `project.json`.
- UI is composed from `@black-isle-beef/novan-design-system`, consumed as an npm package. Its global stylesheet (tokens, Bootstrap 5, Bootstrap Icons, component styles) is pulled in by each app's `src/styles.scss` via `@use '@black-isle-beef/novan-design-system/styles/styles'`.
- Never edit the design system inside `node_modules`. If a finding is caused by a design-system component or style, record it as an upstream issue for the design-system repository instead of working around it locally.
- Angular components are standalone by default; `standalone: true` is not required, but `standalone: false` is a violation. Files follow the current Angular naming style (`landing-page.ts`, not `landing-page.component.ts`).
- There are no npm scripts; run targets through Nx. On Windows PowerShell use `npx.cmd`, for example `npx.cmd nx build web` and `npx.cmd nx test web`.

## Guardrails

- Inspect the current worktree before editing. Preserve unrelated user changes and never modify `node_modules`, `dist`, `.angular`, or `.nx`.
- Do not use `any`, placeholder implementations, broad casts, or regex-only transformations that can change Angular template semantics.
- Keep public selectors, routes, labels, service contracts, and visible behavior stable unless a finding requires a deliberate change.
- Use the Edit tool for source edits. Delete obsolete files only after their styles have been moved and the build confirms there are no references.
- Make one logical slice at a time. After the first substantive edit, run the narrowest focused validation before reading or changing an unrelated slice.
- A static audit finding is evidence, not proof. Confirm each match in context and record false positives or intentional exceptions.

## Step 1: Ingest and Categorize

Run the bundled audit from the repository root. It scans `apps/*/src` and `libs/*/src`, or the `src` folders of the project roots passed with `-Projects`. Do not replace it with an improvised audit or claim audit results without running it.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .claude/skills/angular-scss-compliance-remediator/audit.ps1
```

To audit every Angular project, including nested libraries such as `libs/admin/*`, run `tools/ci/audit-angular.ps1` (CI runs it with `-Affected`).

Capture the complete output, then supplement it with a manual review of the categories the script cannot detect, and group every finding under these categories:

1. **Modern Angular architecture**: NgModules, `standalone: false`, structural directives, legacy `@Input`/`@Output`, manual subscriptions, untyped values, and component stylesheet references.
2. **Global SCSS and design-system compliance**: inline styles, component stylesheets, hardcoded colors, hardcoded pixel layout values, and custom rules replaceable by design-system classes (`ds-*`) or Bootstrap utilities.
3. **Site content and configuration**: brand names, emails, URLs, legal copy, copyright years, social links, and other content repeated across components.
4. **Accessibility and semantic HTML**: missing image alt text, unlabeled controls, invalid ARIA, generic landmark containers, heading-order problems, keyboard-inaccessible interactions, and incorrect button/link semantics.

Before editing, state the number of findings per category and identify any audit false positives. Do not skip a category because the first report appears dominated by another category.

## Step 2: Refactor in Dependency Order

### 2.1 Architecture and shared configuration

- Confirm each app bootstraps standalone (`bootstrapApplication` plus an `app.config.ts`) and remove actual NgModule declarations or imports. Do not remove ordinary `imports` arrays from standalone component metadata; those are valid and required.
- Define or extend interfaces for every shared data structure. Prefer the design system's exported types (for example `NavItem`, `FooterLinkGroup`) over local duplicates. Replace `any` with a specific type or `unknown` plus runtime narrowing.
- When site-wide content is genuinely repeated across components, introduce a typed `SITE_CONFIG` injection token (and a `SiteConfigService` only if behavior is needed) in the app, then inject it into consumers. Do not create one for content used in a single place.
- Keep each app's `src/styles.scss` as the owner of the global cascade. It must keep the design-system `@use` first; app-specific partials go under `src/styles/` and are added through `@use` after it.

### 2.2 Component and template migration

Process components one at a time, starting with shared layout components and then pages. For each component:

- Ensure the component is standalone and its `imports` list contains every template dependency, including design-system components.
- Convert `*ngIf` to `@if`/`@else`, `*ngFor` to `@for` with a stable `track` expression, and `*ngSwitch` to `@switch` with `@case` and `@default`. Preserve empty states and template variable scope.
- Replace `@Input()` with `input()` and `@Output()` with `output()`. Update all call sites and use signal reads correctly in templates and TypeScript.
- Replace local mutable state with `signal()` and derived state with `computed()` where this improves correctness. Keep RxJS for genuine streams and prefer `async` or a signal bridge over manual subscriptions.
- Remove `styleUrl`/`styleUrls` and inline `styles`. Prefer existing design-system classes and Bootstrap utilities; move any remaining rules into an app partial under `src/styles/`, then delete the obsolete component stylesheet only when no references remain.
- Use design-system components instead of hand-rolled equivalents when one exists.
- Keep semantic structure intact: use `header`, `nav`, `main`, `footer`, `section`, `article`, and `form` appropriately. Add accurate `alt` text to meaningful images and `alt=""` to decorative images. Give every form control an associated label and every interactive control an accessible name.

Do not mechanically replace a directive or input declaration without checking its surrounding template and all references. Do not convert a subscription merely to silence the audit if it owns cleanup, error handling, or an external event boundary.

### 2.3 SCSS cleanup

- Move component rules into an appropriate global partial and add that partial through `@use` from the app's `src/styles.scss`.
- Replace hardcoded color literals with design-system tokens (`var(--ds-*)`) or Bootstrap variables. Replace repeated spacing and sizing values with Bootstrap utilities or tokens where semantics remain clear.
- Do not hide forbidden colors or dimensions in CSS custom properties, strings, or generated values. Preserve focus styles and responsive behavior while changing the cascade.
- Keep selectors scoped by component class or semantic region to prevent global leakage, and do not override design-system `ds-*` internals from the app.

### 2.4 Content and accessibility cleanup

- Centralize only site-wide content; keep meaningful control labels, headings, and route-specific explanatory text local when centralizing them would reduce clarity.
- Preserve legal meaning and do not invent company claims, URLs, emails, dates, or accessibility labels. When a value is unknown, stop and report the required product decision rather than fabricating it.
- Replace clickable non-controls with real links or buttons. Ensure dialogs, menus, forms, and cookie controls remain keyboard-accessible and retain visible focus.

## Step 3: Focused Verification Loop

After each component or shared-style slice:

1. Rerun the relevant audit search or the full audit script.
2. Run the project's unit tests, if any exist: `npx.cmd nx test web`.
3. Run `npx.cmd nx build web` after architecture, template, or style changes.
4. Fix regressions in the same slice before moving on.

At the end, run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .claude/skills/angular-scss-compliance-remediator/audit.ps1
npx.cmd nx run-many -t build
npx.cmd nx run-many -t test
```

The audit may still identify patterns that require human review, such as hardcoded copy that is intentionally page-specific. Explain every remaining finding. Do not claim zero violations if the audit exits nonzero.

## Required Completion Output

Provide a concise file-by-file change report first. For each affected file, include:

- the file path;
- the category of violation addressed;
- the behavior-preserving change made;
- the focused validation used.

Then provide complete, untruncated contents for every refactored source file that the user requests. Never use `...`, `// rest of file`, or omitted sections. For deleted files, state the destination of their migrated styles and why deletion is safe.

Finish with:

- initial finding counts by category;
- final audit result and remaining findings;
- build and unit test results;
- issues that belong upstream in the design-system repository;
- explicit assumptions, unresolved product decisions, and intentional exceptions.

If a requested automatic change would require inventing content, changing a public API, or risking template behavior, make the safe code changes that are possible and identify the blocked decision precisely.
