# admin-schema

The content model screens (package 05): the schema page listing content types and block types, and the
type editor with the field builder (palette, drag-and-drop or button reordering, a settings side panel
and a live JSON preview).

Only space admins, developers and agency staff reach these routes (`requireSchemaAccess`, and the shell
shows the Schema link only to them). The API applies the same rule, and validates with the same Zod
schemas (`@novan/shared-schemas`) the editor runs for inline errors.

Run `nx test admin-schema`.
