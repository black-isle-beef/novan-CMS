# admin-editor

The visual editor, `/spaces/:spaceId/pages/:entryId/edit` (docs/build/12-visual-editor.md).

- The page is shown on the space's real site (its address in Space settings), in a frame opened with
  `?novan_preview=<signed token>`. The token comes from `POST .../entries/:id/preview-token`, lasts 15 minutes
  and is renewed two minutes before it expires; the new one goes to the site through the bridge, so the frame
  does not reload.
- `PreviewBridge` is the admin's end of the bridge protocol (`@novan/shared-types`, `bridge.ts`). It reads
  messages only from the frame's window and the site's origin, and sends only to that origin.
- Screen sizes 375, 768 and 1280 px; a Draft / Live switch (Live once the page is published).
- Clicking a block on the page selects it; the panel names it.

Pages open it from the page editor's **Edit on the page** link. Run `nx test admin-editor`; the `@editor`
e2e journey (`apps/admin-e2e/src/editor.spec.ts`) frames the starter site.
