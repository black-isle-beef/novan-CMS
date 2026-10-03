# admin-fields

The entry form controls (package 06): one Angular component per field type in `libs/shared/schemas`
(`fields.ts`), and `nv-field-form`, which renders the controls for a list of field definitions and binds
them to an entry's data.

| Field type | Component | Notes |
| --- | --- | --- |
| `text` | `nv-text-field` | Input, or textarea when multiline |
| `richText` | `nv-rich-text-field` | Tiptap, limited to the field's marks and nodes; stores ProseMirror JSON |
| `number` | `nv-number-field` | |
| `boolean` | `nv-boolean-field` | Switch |
| `date` | `nv-date-field` | Date, or local date and time stored in UTC |
| `select` | `nv-select-field` | Select, or checkboxes when multiple |
| `media` | `nv-media-field` | Asset id and alternative text until the media library (package 07) |
| `link` | `nv-link-field` | Page on the site, web address or email, with link text |
| `reference` | `nv-reference-field` | Select, or checkboxes when multiple |
| `blocks` | `nv-blocks-field` | Add, reorder (drag and drop or buttons), remove and open nested blocks |
| `json` | `nv-json-field` | |
| `group` | `nv-group-field` | Nested fields, or a repeatable list of them |

Provide a `FieldFormContext` on the page that hosts the form: it carries the block types, the entries
reference and link fields can choose from, the validation errors (dotted path to messages, exactly as the
API and `buildEntrySchema` report them) and a read-only switch for roles that cannot edit.

Every control has a visible label, its help and errors linked with `aria-describedby`, and an id from
`fieldId(path)` that error summaries can link to.

Run `nx test admin-fields`.
