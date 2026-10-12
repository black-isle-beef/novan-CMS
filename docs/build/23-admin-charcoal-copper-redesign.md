# 23 — Admin redesign: Charcoal & Copper (Option D)

**Phase:** 2 Visual editor + pilot (polish) · **Estimate:** 5 days (split into 23a–23d PRs) · **Prerequisites:** 11, 12, 13 merged

## Goal

Give the admin (`apps/admin` + `libs/admin/*`) the approved **Option D · Charcoal & Copper** look. It is a dark, warm UI on charcoal grey, with **brushed copper** on primary actions and **solid copper** on links, selection and focus. It gives the header a compact top bar, keeps the space menu in the left sidebar (decided 2026-10-12: a space has too many sections for a top bar, and they read best as a sidebar), and brings in a search-led dashboard and a three-panel visual editor. **Nothing about behaviour changes.** Every route, permission check, guard, shortcut, ARIA relationship, plain-language copy rule and e2e journey that works today must work the same way afterwards. This is a re-skin and re-layout, not a rewrite.

## Design reference

The approved mock-up is in `docs/build/assets/23-charcoal-copper/`. Treat it as the visual target, not as a spec for content.

| File | Shows |
| --- | --- |
| `Novan-CMS-Option-D-Charcoal-Copper.png` | Dashboard and visual editor, full size |

The mock-up uses sample content ("Harbour Coffee", "Alex", "Jamie", the "Activity" list). **Never copy sample names or invent data.** Every value on screen comes from the existing APIs. Where the mock-up shows something the API cannot provide yet, follow the "Data mapping" table in 23c.

## Palette

Charcoal and the neutrals come from the Novan Design System palette. **Copper is a new brand accent**, and step 1 adds it to the design system. It must not exist only in the CMS.

| Role | Token to create | Value | Source |
| --- | --- | --- | --- |
| Page background, top bar, editor canvas | `--ds-color-copper-theme-canvas` | `#262626` | New: Charcoal 900 |
| Cards, panels, menus | `--ds-color-copper-theme-surface` | `#333333` | Palette: Charcoal |
| Raised/selected surface, active nav pill, inactive progress | `--ds-color-copper-theme-raised` | `#3d3d3d` | New: Charcoal 700 |
| Decorative borders, dotted grid | `--ds-color-copper-theme-line` | `#4d4d4d` | New: Charcoal 600 |
| **Form-control borders** and other meaningful boundaries | `--ds-color-copper-theme-control` | `#838484` | Palette: Neutral 400 |
| Solid copper: links, icons, focus ring, selection outlines, current step | `--ds-color-copper-500` | `#d9955a` | New: Copper 500 |
| Copper mid / deep (gradient stops, pressed state) | `--ds-color-copper-600` / `--ds-color-copper-700` | `#c98850` / `#b37543` | New |
| Copper light (gradient highlight) | `--ds-color-copper-300` | `#e6ae7a` | New |
| Copper pale: text on copper-tinted chips | `--ds-color-copper-100` | `#f3dcc6` | New |
| Copper deep brown: avatar / brand chip background | `--ds-color-copper-900` | `#5a3a24` | New |
| **Brushed copper** fill (primary buttons, progress, selection labels) | `--ds-gradient-copper-brushed` | see below | New |
| Text on copper (solid or brushed) | `--ds-color-copper-theme-on-accent` | `#141414` | New |
| Body text | `--ds-color-copper-theme-text` | `#ffffff` | Palette: White |
| Secondary and subtle text (placeholders included) | `--ds-color-copper-theme-text-muted` | `#b0b3b5` | Palette: Neutral 300 |
| Success / warning / danger text on charcoal | | `#57b788` / `#f0b429` / `#fbdde0` | Palette: Green 400 / Gold 400 / Rose 100 |

**Brushed copper.** Faint streaks laid over a diagonal metallic gradient:

```scss
--ds-gradient-copper-brushed:
  repeating-linear-gradient(100deg, rgb(255 255 255 / 0.07) 0 1px, rgb(0 0 0 / 0.05) 1px 3px),
  linear-gradient(135deg, var(--ds-color-copper-300) 0%, var(--ds-color-copper-600) 40%,
                  var(--ds-color-copper-700) 66%, #d9a06c 100%);
```

Hover brightens it (`filter: brightness(1.06)`), active darkens it (`brightness(0.94)`). Under `prefers-contrast: more` and in forced-colours mode, fall back to solid `--ds-color-copper-500` with a visible border.

**Contrast rules (checked; keep them when implementing):**
- Text on copper is always `#141414`. It reaches at least 4.8:1 on the darkest gradient stop and 7.4:1 on solid copper. Never put white text on copper.
- Solid copper text passes on canvas (6.0:1) and surface (5.0:1) but **not on the raised surface** (4.3:1). On `#3d3d3d`, copper is for icons and borders only, or for text that is bold and at least 18.66px.
- Secondary text is Neutral 300 everywhere (6.0:1 on charcoal). **Neutral 500 is too faint for text on charcoal** (3.6:1).
- Form-control borders use Neutral 400 (3.4:1 on surface, 4.0:1 on canvas) to meet WCAG 1.4.11. Charcoal 600 (1.5:1) is for decorative card borders only.
- Danger text uses Rose 100. Red 600 fails on charcoal (2.1:1).
- Copper and Gold 400 (warning) are both warm. Anything marking state (selected, current, draft, warning) also carries text or an icon, never colour alone.
- Focus ring everywhere: `0.125rem` solid `--ds-color-copper-500` with `0.125rem` offset, via `:focus-visible`.

## Tasks

### 23a — Design system: Copper theme and app header (repo `black-isle-beef/novan-design-system`, 1.5 days)

Do this first and release it. The CMS must not hard-code these colours (see `angular-scss-compliance-remediator`).

1. **Palette tokens.** In `tokens/color.tokens.json` add `color.palette.charcoal.{600,700,900}` (`#4d4d4d`, `#3d3d3d`, `#262626`) and `color.palette.copper.{100,300,500,600,700,900}` from the table, each with a `$description` of its intended use. Also add the existing brand-palette colours the theme reuses but that are not tokenised yet: `neutral.{300,400}`, `green.400`, `gold.400`, `rose.100`. Add Copper to `brand-palette.ts` and the Brand foundation story so the palette documentation stays the single source. Regenerate tokens (`npm run build:tokens`).
2. **Copper theme.** Add `src/styles/_copper-theme.scss`, imported from `styles.scss` after `dark-mode`. Under `[data-ds-theme='copper']` it declares every `--ds-color-copper-theme-*` token and `--ds-gradient-copper-brushed`, then maps the existing semantic tokens onto them:
   - DS semantic tokens: `--ds-color-surface-body`, `--ds-color-surface-muted`, `--ds-color-text-body`, `--ds-color-text-muted`, `--ds-color-brand-primary` (solid copper, so existing links and outlines pick it up), `--ds-link-hover-color` (copper 300).
   - Bootstrap runtime variables: `--bs-body-bg`, `--bs-body-color`, `--bs-secondary-color`, `--bs-border-color`, `--bs-tertiary-bg`, `--bs-link-color`, `--bs-focus-ring-color`.

   It is used **together with** `data-bs-theme="dark"`, so Bootstrap's own dark component variables (forms, dropdowns, modals, tables) apply first and the copper theme refines them. Form controls get `--bs-border-color` = the control token, not the decorative line.
3. **Buttons.** Under the same selector:
   - `btn-primary` uses the brushed-copper background with `#141414` text, with the hover/active filters and the high-contrast fallback described above.
   - `btn-secondary` is transparent with a Neutral 400 border and white text.
   - `ds-progress` uses the brushed fill for its value.

   Verify each in Storybook against axe.
4. **`ds-header` app variant.** Add `variant = input<'site' | 'app'>('site')`. The `app` variant is a single compact row (brand, nav, actions) with the nav rendered as pills. The active item gets the raised surface and `aria-current="page"`. Add an optional `icon?: string` (Bootstrap Icons class) to `NavItem`, rendered with `aria-hidden="true"`. Below the `md` breakpoint the nav collapses into the existing menu button. Keep the skip link and `#ds-main-content` target unchanged.
5. **Storybook.** Add `Themes/Charcoal & Copper` stories with the axe addon passing: header (app variant, icons, active item), buttons, form controls, alert, badge, progress, toast, modal and sidebar.
6. **Release.** Conventional commit `feat(theme): charcoal & copper theme and app header variant`, merged so semantic-release publishes a minor version (2.6.0 or later).

> If the design-system release cannot ship first, put the token values in `apps/admin/src/styles/tokens/_copper.scss` (the SCSS audit excludes `styles/tokens/`), apply them under the same selector, and open an issue to move them upstream. Do **not** scatter hex values or gradients through component partials.

### 23b — Shell: top navigation and theme (CMS repo, 1 day)

7. Bump `@black-isle-beef/novan-design-system` to the release from step 6 and run `npm install`.
8. `apps/admin/src/index.html`: add `data-bs-theme="dark" data-ds-theme="copper"` to `<html>` and `lang="en-GB"`. Every admin screen, including sign-in (`libs/admin/auth`) and every dialog, now renders on the copper theme.
9. **Logos.** Copy `docs/build/assets/23-charcoal-copper/logos/compass-mark-white.svg` and `novan-word-white.png` into `apps/admin/public/logos/`. In `admin-shell.html` replace the text brand with:
   ```html
   <a dsBrand routerLink="/spaces" class="nv-brand" aria-label="Novan CMS, all spaces">
     <img src="logos/compass-mark-white.svg" alt="" class="nv-brand__mark" />
     <img src="logos/novan-word-white.png" alt="" class="nv-brand__word" />
     <span class="nv-brand__tag" aria-hidden="true">CMS</span>
   </a>
   ```
   Both images are decorative, because the link's accessible name carries the meaning. Do the same in `auth-layout.html`, without the link. The `CMS` tag is a small chip with copper-pale text and a thin copper border on a copper-tinted background.
10. **Compact top bar; the space menu stays in the sidebar.** In `admin-shell.html` use `<ds-header variant="app">` and keep `<ds-sidebar ariaLabel="Space">` for the space menu (on the copper theme: charcoal surface, raised active item with a copper edge). `headerNav` holds Spaces and Account, and keeps the `narrow()` branch: below `md` the space menu (icons passed through) moves into the header's menu button. Role filtering stays in `buildSpaceNav`; do not touch `spaceNav` order or permissions. Update `admin-shell.spec.ts` for the new header.
11. **Header actions** stay in `dsActions`, in this order:
    - search button (icon + "Search", `Ctrl K` hint)
    - `nv-space-switcher`
    - `nv-view-as-menu`, for agency staff
    - an account avatar button: initials from `AuthService.email()` until profiles have names, on the copper-deep chip. It opens the existing Account / Sign out actions, and Sign out must stay one keyboard step from the menu.

    Notifications are **out of scope** (there is no backend).
12. `_shell.scss`: keep the sidebar layout rules; `.nv-shell__main` keeps its scrolling behaviour. Add `.nv-brand*` rules (mark 2.25rem, word 1.2rem high).

### 23c — Dashboard (CMS repo, 1 day)

13. Rebuild `dashboard-page.html` to the mock-up layout using the **existing** signals and components:
    - **Hero** (centred, with a soft copper glow behind it: a `radial-gradient` of copper at about 16% opacity, decorative, using tokens):
      - `<h1>` "What are we working on?" (the shell's focus-on-navigation still targets `main h1`).
      - A large search button styled as an input, with a thin copper focus halo, that opens the shell's search palette. Add `Shortcuts.trigger(action)` to `libs/admin/shell/src/lib/shortcuts/shortcuts.ts` with a unit test, and call `trigger('search')`.
      - The brushed-copper **New page** button (existing `canEditCurrent()` check).
      - Up to four outline chips, each shown only when the role allows it: *Edit home page* (visual editor for `homePageId()`), *Upload images* (`media.read`), *Read form replies* (`forms.read`), *Site settings*.
    - **Row 1:**
      - *Site card*: space name, a "Live" status pill with text, the site address in copper (from space settings), and *Open editor* (white button) and *Settings* (outline) buttons.
      - *Launch checklist*: `nv-onboarding-checklist`, restyled. The progress bar is segmented, with brushed segments for done steps. Done steps are struck through and keep their visually-hidden "(done)" text. The current step sits on the raised surface with a copper ring icon.
    - **Row 2:**
      - *Recently edited*: thumbnail tile, title, path, relative time and a status badge from `statusBadges`.
      - *Waiting for review*, followed by *Changes not live yet* (the existing `reviews()` and `drafts()` lists).
14. **Data mapping.** No invented values:

    | Mock-up element | Source |
    | --- | --- |
    | "Alex" in the greeting | Leave it out. Add the name back when profiles store a display name. |
    | Site thumbnail | Neutral placeholder tile, `aria-hidden="true"`. No screenshots in this package. |
    | "Last published 2 hours ago" | Only if the space summary already exposes it; otherwise omit the line. |
    | Activity feed | Replaced by *Waiting for review* + *Changes not live yet*. The audit log is admin-only. |
    | Notification bell | Not built (out of scope). |
    | Forms badge "3" | Only if the forms API already exposes an unread count; otherwise no badge. |
    | "Change opening hours" chip | Sample content. Use *Site settings* instead. |

15. Move dashboard rules into `apps/admin/src/styles/_dashboard.scss` (new partial, `@use`d from `styles.scss`): `.nv-dash-hero`, `.nv-dash-glow`, `.nv-dash-search`, `.nv-dash-chip` and `.nv-card`. `.nv-card` gets the charcoal surface, the decorative line border and `var(--bs-border-radius-xl)`. Use tokens only.

### 23d — Visual editor layout (CMS repo, 1.5 days)

16. Re-lay out `visual-editor-page.html` as three regions on a dotted charcoal canvas: `.nv-editor-canvas`, a `radial-gradient` of the line token on the canvas token, 18px grid. The regions:
    - **Toolbar** (one wrapping row, in this order):
      - breadcrumb (kept as `nav aria-label="Breadcrumb"`)
      - page title `<h1>`
      - save state (`role="status"` kept, with a copper dot for "draft")
      - the existing **Screen size** and **Show** radio fieldsets, restyled as one segmented control each, with the checked option on the raised surface
      - undo/redo/save (same buttons, shortcuts and `aria-keyshortcuts`)
      - presence avatars (a copper ring marks someone editing)
      - the workflow (`nv-page-workflow`), with Publish as the brushed-copper primary action
    - **Left panel:** "Blocks on this page" (`nv-block-outline`) and its add button, moved out of the side tabs. The selected row gets a copper inset outline and the raised surface.
    - **Centre:** `.nv-editor-stage` + iframe, unchanged in behaviour (device widths, `tabindex="0"`, `role="region"`, fallback alerts). The stage gets a Charcoal 600 hairline and a deep shadow instead of the grey surround.
    - **Right panel:** the existing tabs (`role="tablist"` with arrow-key handling) for *Block* and *Search and sharing*, then *Before publishing*. The focused field shows the copper focus ring.
    - Below 1200px wide the panels stack: toolbar, stage, block panel, outline, checklist. Nothing is hidden.
17. Keep **every** `id`, `aria-*`, heading, `role="status"` region and element order inside each region. `apps/admin-e2e/src/editor.spec.ts` and `workflow.spec.ts` must pass **without editing their selectors**. If a selector truly depends on the old layout, change the test minimally and say why in the PR.
18. `_editor.scss`: update `.nv-outline-row-selected`, `.nv-avatar*` and the stage for the copper theme; add `.nv-editor-canvas`, `.nv-editor-toolbar` and `.nv-editor-panel--left/--right` (floating cards on the charcoal surface).

### Everywhere

19. Walk every other admin route on the copper theme and fix anything that hard-codes light colours: spaces list, content list and form editor, media library and picker, schema, settings, members, API tokens, webhooks, audit log, forms, account, sign-in and set password. Use tokens only. Record anything caused inside a DS component as an upstream issue.
20. Add `23 | 23-admin-charcoal-copper-redesign.md | 2 polish` to the table in `docs/build/README.md`.

## Out of scope

- Notifications (bell, unread counts)
- User display names and avatars
- A theme switcher: Charcoal & Copper is the only admin theme for now
- Site screenshots
- Options A–C
- Any API or database change
- Client-site (`apps/starter-site`) styling

## Verify

```bash
# design system repo
npm run build:tokens && npm run build:lib && npm run test:lib && npm run test:a11y

# CMS repo
npx nx affected -t lint test build
npx nx e2e admin-e2e                    # all journeys, including @shell, @editor and the forbidden-words scan
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .claude/skills/angular-scss-compliance-remediator/audit.ps1
```

Then run the `angular-accessibility-audit-remediator` skill over `apps/admin`: axe on every route, and a keyboard pass through the header, dashboard and editor. Check at 200% zoom, at 375px wide, with `prefers-contrast: more` (solid copper fallback), and in Windows forced-colours mode.

Manual check against `Novan-CMS-Option-D-Charcoal-Copper.png`: at 1440px wide the dashboard and editor look like the mock-up, with real data in place of the samples. The brushed finish is visible on primary buttons, and solid copper is used for links and outlines.

## Definition of done

- [ ] Design system released with the copper palette, the Charcoal & Copper theme and the `ds-header` app variant; Storybook axe clean
- [ ] Admin renders on the copper theme on every route, including sign-in and dialogs; no hex values or gradients outside token files (SCSS audit passes)
- [ ] Compact top bar with the space menu kept in the sidebar; role filtering unchanged and covered by tests
- [ ] Dashboard and editor match the mock-up layout with no invented data
- [ ] All existing e2e journeys pass; any test change is justified in the PR
- [ ] Accessibility audit clean on shell, dashboard and editor; text, control borders and focus meet WCAG 2.2 AA contrast, including the high-contrast fallback
- [ ] Conventions' Definition of done ticked
