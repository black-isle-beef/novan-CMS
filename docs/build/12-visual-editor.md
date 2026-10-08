# 12 — Visual editor

**Phase:** 2 Visual editor + pilot · **Estimate:** 10 days (split into 12a–12c PRs) · **Prerequisites:** 11

## Goal

Editors edit pages on the real site: click a block to edit it in a side panel, add blocks from a picker, reorder them, and see every change live in the preview — built in-house with Angular, no third-party canvas.

## Architecture

```
Admin (apps/admin, libs/admin/editor)          Client site in iframe (preview mode)
┌───────────────────────────────┐   postMessage   ┌─────────────────────────────┐
│ Editor store (signals)        │ <────────────── │ Bridge (in cms-angular SDK,  │
│  - draft data, selection,     │  ready, select, │  lazy-loaded in preview)     │
│    undo/redo stack            │  hover, rects   │  - outlines blocks by _uid   │
│ Side panel (field forms)      │ ──────────────> │  - re-renders with new data  │
│ Block list (CDK drag-drop)    │  update, select │  - reports block rectangles  │
│ Block picker                  │                 │                              │
└───────────────────────────────┘                 └─────────────────────────────┘
```

### Bridge protocol (`libs/shared/types/src/lib/bridge.ts`)

All messages are `{ source: 'novan', v: 1, type, payload }`. The bridge only accepts messages from the configured admin origin; the admin only accepts messages from the space's `preview_url` origin.

| Direction | type | payload |
| --- | --- | --- |
| site → admin | `ready` | `{ path, sdkVersion }` |
| site → admin | `select` | `{ uid }` (user clicked a block) |
| site → admin | `hover` | `{ uid \| null }` |
| site → admin | `rects` | `{ [uid]: DOMRect }` (on render, scroll, resize) |
| admin → site | `update` | `{ data }` (whole page data, debounced 150 ms) |
| admin → site | `select` / `hover` | `{ uid \| null }` |
| admin → site | `scrollTo` | `{ uid }` |

## Tasks

### 12a — Bridge and preview (3 days)

1. In `@black-isle-beef/cms-angular`: bridge module loaded only in preview mode. `<novan-blocks>` wraps each block in an element with `data-novan-uid`. Bridge draws hover/selection outlines with a label (block name) in an overlay layer, posts `select`/`hover`/`rects`, and applies `update` by replacing the page data signal (no page reload).
2. Signed preview tokens: admin asks the API for a short-lived (15 min) signed token for `{ spaceId, entryId }`; the site exchanges it via the Preview API. Tokens are refreshed by the admin.
3. Admin editor route `/spaces/:spaceId/pages/:entryId/edit` with the iframe, device toggles (375 / 768 / 1280 px) and draft/live switch.

### 12b — Editing (4 days)

4. Editor store (signals): page data, selected `_uid`, dirty flag, undo/redo (patch-based, 100 steps), autosave every 5 s to the draft endpoint from 06.
5. Side panel: when a block is selected, render its field forms (reuse `libs/admin/fields`) and its style options as preset pickers. Edits patch the store and post `update`.
6. Block list (outline) panel: tree of blocks with CDK drag-drop reorder, move into/out of containers that allow children, duplicate, delete, hide.
7. Block picker dialog: blocks allowed at the insertion point (`allowedBlocks` / `allowed_children`), with icon, name and preview image; inline "+" buttons between blocks drawn by the bridge.
8. Inline text editing for plain `text` fields (bridge makes the element `contenteditable`, posts changes back). Rich text stays in the side panel for v1.

### 12c — Collaboration and polish (3 days)

9. Presence and soft locks with Supabase Realtime: channel per entry; show avatars of others viewing; if someone else has unsaved edits, show a banner and make the page read-only until they leave or the lock expires (60 s heartbeat).
10. Validation messages in the side panel and a pre-publish checklist (missing required fields, missing alt text, heading order warnings from the bridge reading the DOM).
11. Fallback: if the iframe never sends `ready` within 10 s, show the form view (06) with an explanation and a "check preview URL" link for developers.

## Decisions made during this package

### 12a — Bridge and preview

- **Signed preview tokens** are `<payload>.<signature>` (base64url JSON `{ v, s: spaceId, n: environmentId,
  e: entryId, x: expiry }`, HMAC-SHA256) signed with `PREVIEW_SIGNING_SECRET` (API only; required in production,
  made up per process locally). `POST /v1/management/spaces/:spaceId/environments/:env/entries/:id/preview-token`
  issues one to any member who can read the page (RLS decides; 404 for the bin or another space) for 15 minutes.
  `GET /v1/preview/session` (preview token + `X-Novan-Preview`) exchanges it for `{ entryId, expiresAt,
  adminOrigin }`, and refuses (403 `preview_not_allowed`) a token signed for another space or environment. The
  Preview API's content routes still need only the `nv_pre_` token; the site's proxy checks the signed token.
- **The admin origin comes from the API** (`ADMIN_URL`) in the session, not from site configuration. It travels
  to the browser in transfer state (`novan:preview` is now `{ active, session }`), is the bridge's only trusted
  origin, and goes into `Content-Security-Policy: frame-ancestors 'self' <admin>` on preview pages.
- **SDK 0.3.0:** `createNovanPreviewVerifier` (`/server`) is the `verifyPreview` (answers cached for up to a
  minute, refusals for 10 s, fails closed). `verifyPreview` may answer with the session; only a session starts the
  bridge, and only inside a frame. `NovanPreview.withLiveData(page)` applies `update` to the page being edited
  (matched by the session's `entryId`); sites read their page through it in a `computed`. The bridge entry has no
  imports from the main entry (ng-packagr refuses the cycle), so `NovanBridgeHost`/`NovanBridgeHandle` live there.
- **Protocol** (`libs/shared/types/src/lib/bridge.ts`) adds admin → site `token { token }`: the admin renews the
  signed token two minutes before expiry and hands it over without reloading the frame. Rects are plain
  `{ x, y, width, height }` in the frame's viewport. Validators are dependency-free; the SDK keeps a copy that
  `src/bridge/protocol.spec.ts` holds in step.
- **Wrappers:** in preview only, `<novan-blocks>` wraps each block (unknown ones too) in
  `<div data-novan-uid data-novan-block>`; live pages are unchanged. The overlay sits outside `<body>`,
  `aria-hidden`, with inline styles and a fixed accent colour, because the SDK cannot rely on a site's
  stylesheet. Labels are the block's api id in words (`richText` → "Rich text").
- **Clicks** in a block select it; links and submit buttons in it are not followed. Other clicks still work
  (carousels, accordions).
- **Admin:** new library `libs/admin/editor` (`@novan/admin-editor`); the page editor links to it ("Edit on the
  page") for `page` entries. The selected block is announced in the panel (`role="status"`). The home page's
  address on the site is `/` (`sitePath` in `@novan/shared-schemas`), which also fixes the page editor's "View
  live page" link for the home page.
- **Local setup:** `supabase/seed.sql` seeds a public preview token for the demo space
  (`NOVAN_PREVIEW_TOKEN` in `apps/starter-site/.env.serve` and `.env.example`), and `admin-e2e` starts the starter
  site, which the demo space's address already points at.
- **Bundle:** the frame's address is set on the element by the page, not bound with `[src]`: Angular's
  resource-URL sanitizer would otherwise add about 8 kB to the admin's initial bundle. The address is built only
  from the space's http(s) address, a stored path and an encoded token. The initial bundle is 854 kB, as on
  `main` (package 11's open budget issue).
- **Not yet:** the `update` data must be in the delivered shape (expanded assets and references). 12b adds the
  management endpoint that turns draft data into it.

### 12b — Editing

- **Preview data:** `POST .../entries/:id/preview-data` (`{ data, include? }`, any member who can read the page)
  checks the unsaved data as a draft (400 `entry_invalid`) and returns it as the Preview API would deliver it
  (`ContentReader.render`): files, references and link targets of the entry's own space only. Nothing is saved.
  The admin sends changes 150 ms after the last one; only the latest request reaches the site, and malformed data
  (half-typed) is skipped, so the site keeps the last good version. Locally a change reaches the frame in roughly
  one request plus the debounce.
- **Editor store** (`EditorStore`): page data, selected `_uid`, dirty flag, and undo/redo as patches (only the
  changed paths; `patches.ts`), 100 steps. Changes to the same field within a second are one step, so typing a word
  is one undo. Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y outside text fields (fields keep their own undo).
- **Autosave** every 5 s through the autosave endpoint from 06, skipped while the draft has malformed values (shown
  at once in the panel) or while text is being typed on the page. Leaving with unsaved changes asks first.
- **Block lists** are the content type's top-level `blocks` fields and, inside them, `children` of block types with
  `allowedChildren`. Blocks fields inside groups stay in the form view. The panel reuses `libs/admin/fields`, with the
  block's dotted path, so validation messages match the form view; style options are radio buttons, selects and
  switches (`StylePicker`). The panel sends only the keys that changed, applied to the block as it is now.
- **Outline:** CDK drag and drop across connected lists (only lists that allow the block, never into itself), plus
  arrow buttons; "Move into <previous block>" / "Move out of <parent>", duplicate (new `_uid`s for the block and
  everything in it), hide and delete in the panel. Moves and deletes are announced; focus stays with the block.
- **Hidden blocks** are `_hidden: true` in block data (`buildEntrySchema` keeps it). The Delivery and Preview APIs
  leave them out (`EntryVisitor.block`), and `<novan-blocks>` skips them too.
- **Picker:** a design-system dialog with the types allowed at the insertion point, their icons and preview images.
  `previewImagePath` is a path on the space's site (`/blocks/hero.png`) or an https address; anything else shows no
  image.
- **Protocol additions** (SDK 0.4.0): site → admin `insert { uid, position: 'before' | 'after' }` and
  `text { uid, field, value, done }`; admin → site `editable { uid, fields: [{ field, value, multiline }] }`. The
  bridge draws "+" buttons and allows inline text editing only after an `editable` arrives, so viewers never get
  them. Inline editing finds the element by `data-novan-field="<field>"`, else the element whose whole text is the
  field's value; it uses `contenteditable="plaintext-only"`, Enter ends a one-line field, Escape puts the text back.
  While typing, the admin updates its store but sends no `update` (that would reset the caret) until `done`.
- **Publish** in the editor saves and publishes directly; package 13 replaces it with the publish dialog.

### 12c — Collaboration and polish

- **Presence** uses Supabase Realtime presence on private channels `editor:<space id>:<entry id>`
  (`supabase/migrations/0010_editor_presence.sql`): RLS on `realtime.messages` lets only members of that space (and
  agency staff with a second factor) join, read or track, and only presence goes over them; pgTAP in
  `supabase/tests/editor_presence.test.sql`. The admin loads `@supabase/realtime-js` (now a direct dependency, as
  the locked decision on separate Supabase packages says) only in the visual editor, and calls `setAuth()` before
  joining so the join carries the person's token, not the anon key.
- **Soft locks:** each tab tracks `{ session, userId, name, editing, since, at }` with a 20 s heartbeat. A tab is
  *editing* while it has unsaved changes and for 60 s after its last change. Another tab that is editing and was
  heard from in the last 60 s holds the page; when two start together, the earlier `since` wins (then the lower
  session id). Others see "<name> is changing this page" and a read-only editor (no panel edits, no "+" buttons, no
  inline text). When the lock ends, the page reloads the latest draft before anyone else can edit, so nobody saves
  over a stale copy. A tab that loses a tie keeps its unsaved changes only until that reload (soft lock, not a merge).
- **Avatars:** initials of the other people (one per person, however many tabs), with a solid ring for someone editing;
  names are in the list for screen readers. Display names come from `/me` (else the email address).
- **Validation** in the panel: malformed values and everything that would stop publishing (`buildEntrySchema`
  without `draft`) show by their fields. **Before publishing** lists those errors (with "Go to block"), images with no
  alternative text on the page or in the library (warnings; required alt text is an error), and heading order from the
  site's DOM: the bridge sends `headings { headings: [{ level, text, uid }] }` after each render, and the admin warns
  about no H1, several H1s and skipped levels. Publish refuses while there are errors and focuses the list.
  `PublishChecklist` and `pageChecks` are for package 13's publish dialog too.
- **Protocol** (still SDK 0.4.0): `editable` has `insert: boolean`, so a tab that becomes read-only withdraws the
  "+" buttons; site → admin `headings`.
- **Fallback:** when the frame has not said `ready` 10 s after its address was set, an alert offers **Edit in the
  form**, and space admins a link to the site's address in Space settings.
- **Audit:** `audit.ps1` takes `// audit-ignore <rule>: <reason>` on a finding's line or the line above, for confirmed
  false positives only. The one use is Realtime's `channel.subscribe(...)`, which is not RxJS.

## Out of scope

Free drag-on-canvas positioning, custom CSS, A/B variants (phase 4).

## Verify

```bash
npx nx test cms-angular admin-editor     # protocol validation, origin checks, undo/redo, store patches
npx nx e2e admin-e2e --grep @editor      # open page, click hero in iframe, change heading, see it update,
                                         # add CTA via picker, reorder, undo, autosave, publish, site shows change
```

Manual check: two browsers on the same page show presence and lock correctly.

## Definition of done

- [x] Messages from unexpected origins are ignored (tested)
- [x] An editor can build a page from blocks without touching the form view
- [ ] Edits appear in the preview in under 300 ms on a mid-range laptop (150 ms debounce plus one local API request;
      not yet timed on a reference laptop)
- [x] Keyboard accessible: blocks selectable and reorderable without a mouse
