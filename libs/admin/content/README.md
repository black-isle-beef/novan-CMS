# admin-content

Content screens (package 06):

- **Content** (`/spaces/:spaceId/content`, the space's home): the page tree of folders and pages with status
  badges, search, new page and folder dialogs, renaming and deleting folders, and the bin.
- **Editor** (`/spaces/:spaceId/content/:entryId`): the form view generated from the content type
  (`@novan/admin-fields`), save draft and autosave, publish, unpublish, move, delete, and the version
  history drawer with plain-language differences and restore.

Every member can open both; what they can do follows their role, as in the API: authors and up save
drafts and add folders, editors and up publish, unpublish, use the bin and rename or move folders, and
viewers see a read-only form. Client-facing copy says "page", "publish" and "save draft".

Errors come from the same `buildEntrySchema` the API uses: saving checks the draft rules (values must be
well formed), publishing also checks required fields. An error summary links to each field.

Run `nx test admin-content`.
