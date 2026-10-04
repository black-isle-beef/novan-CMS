# admin-media

The media library screens (package 07):

- **Media** (`/spaces/:spaceId/media`): drag-and-drop multi-upload with progress (straight to Storage on
  signed URLs, then checked by the API), folders, type and tag filters, search, grid or list view, and the
  bin. Opening a file shows its details: preview with a focal point picker (click, arrow keys or sliders),
  alt text, title, tags and folder, the published pages using it, replacing the file (same id) and
  deleting it, with an "in use on N pages" warning.
- **Picker** (`MediaPicker` + `<nv-media-picker>`): the dialog media fields open to choose files, with
  search and upload. Provide `MediaPicker` on the page that hosts a form, `connect` it to the form's
  `FieldFormContext`, and place one `<nv-media-picker />` on the page (the entry editor does).

Thumbnails are signed URLs from the user's own Supabase session (`Thumbnails`), so storage RLS decides what
they can see. Roles follow the API: authors and up upload and describe their own files, editors and up
describe any file, replace files and use the bin, viewers browse.

Run `nx test admin-media`; the `@media` e2e journey covers the whole flow with axe checks.
