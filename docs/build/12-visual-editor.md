# 12 — Visual editor

**Phase:** 2 Visual editor + pilot · **Estimate:** 10 days (split into 12a–12c PRs) · **Prerequisites:** 11

## Goal

Editors edit pages on the real site: click a block to edit it in a side panel, add blocks from a picker, reorder them, and see every change live in the preview — built in-house with Angular, no third-party canvas.

## Architecture

```
Admin (apps/admin, libs/admin/editor)          Client site in iframe (preview mode)
┌───────────────────────────────┐   postMessage   ┌─────────────────────────────┐
│ Editor store (signals)        │ <────────────── │ Bridge (in @novan/cms-angular│
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

1. In `@novan/cms-angular`: bridge module loaded only in preview mode. `<novan-blocks>` wraps each block in an element with `data-novan-uid`. Bridge draws hover/selection outlines with a label (block name) in an overlay layer, posts `select`/`hover`/`rects`, and applies `update` by replacing the page data signal (no page reload).
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

- [ ] Messages from unexpected origins are ignored (tested)
- [ ] An editor can build a page from blocks without touching the form view
- [ ] Edits appear in the preview in under 300 ms on a mid-range laptop
- [ ] Keyboard accessible: blocks selectable and reorderable without a mouse
