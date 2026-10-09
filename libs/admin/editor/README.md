# admin-editor

The visual editor, `/spaces/:spaceId/pages/:entryId/edit` (docs/build/12-visual-editor.md).

- The page is shown on the space's real site (its address in Space settings), in a frame opened with
  `?novan_preview=<signed token>`. The token comes from `POST .../entries/:id/preview-token`, lasts 15 minutes
  and is renewed two minutes before it expires; the new one goes to the site through the bridge, so the frame
  does not reload.
- `PreviewBridge` is the admin's end of the bridge protocol (`@novan/shared-types`, `bridge.ts`). It reads
  messages only from the frame's window and the site's origin, and sends only to that origin. The page sets its
  `listener` for clicks, "+" buttons and text typed on the page.
- Screen sizes 375, 768 and 1280 px; a Draft / Live switch (Live once the page is published).
- `EditorStore` holds the page data, the selection and undo/redo (patches from `patches.ts`, 100 steps).
- `block-tree.ts` finds, inserts, moves, copies and removes blocks in the page data (pure functions).
- `BlockPanel` edits the selected block (fields from `@novan/admin-fields`, style options in `StylePicker`),
  `BlockOutline` lists, selects and reorders blocks, `BlockPicker` adds them.
- `EditorPresence` shows who else has the page open and holds a soft lock while someone edits (Supabase Realtime
  presence on private channels; see `supabase/migrations/0010_editor_presence.sql`).
- The side panel has two tabs (`role="tablist"`, arrow keys move between them): **Blocks** (the selected block and
  the outline) and **SEO** (`SeoPanel`, docs/build/14-seo-site-features.md): the page's `seo` group with character
  counts, a search-result preview and a social card preview, falling back to the page title and the site's sharing
  image from site settings. Selecting a block switches back to Blocks.
- The pre-publish checklist (`pageChecks`, `PublishChecklist`) comes from `@novan/admin-content`, shared with the
  form view's publish dialog. It sits below the tabs, so publishing can focus it whichever tab is open.
- Changes reach the site through `POST .../entries/:id/preview-data` (the delivered shape) 150 ms after the last
  one; drafts autosave every 5 s.

Pages open it from the page editor's **Edit on the page** link. Run `nx test admin-editor`; the `@editor`
e2e journey (`apps/admin-e2e/src/editor.spec.ts`) frames the starter site.
