# 05 — Content modelling (schema builder)

**Phase:** 1 Headless core · **Estimate:** 6 days · **Prerequisites:** Gate 0

## Goal

Agency developers can define content types (pages, entries, singletons) and block types in the admin, with validation rules, without a redeploy.

## Data

Migration `0005_content_model.sql`:

- `content_types (id, space_id, environment_id, api_id, name, kind text check in ('page','entry','singleton'), description, fields jsonb, created_at, updated_at, unique (environment_id, api_id))`
- `block_types (id, space_id, environment_id, api_id, name, icon, preview_image_path, fields jsonb, allowed_children text[], style_options jsonb, schema_version int, unique (environment_id, api_id))`
- RLS: read for members; write for `admin`/`developer` roles. pgTAP cross-tenant tests.

## Field definition format (`libs/shared/schemas/src/fields.ts`)

A Zod discriminated union, `FieldDef`, with common props `{ id, apiId, label, help?, required, localised, hidden? }` and one variant per type:

| type | extra props |
| --- | --- |
| `text` | `multiline`, `min`, `max`, `pattern` |
| `richText` | `marks[]`, `nodes[]` allowed |
| `number` | `min`, `max`, `integer` |
| `boolean` | `default` |
| `date` | `withTime` |
| `select` | `options[{ value, label }]`, `multiple` |
| `media` | `accept[]` (image, video, file), `multiple`, `requireAlt` |
| `link` | `allowExternal`, `allowEmail` |
| `reference` | `contentTypes[]`, `multiple` |
| `blocks` | `allowedBlocks[]`, `min`, `max` |
| `json` | — |

Also export `buildEntrySchema(fields: FieldDef[]): ZodType` that turns a field list into a validator for entry data. This one function is used by the API on save and by the admin forms.

`style_options` on block types uses the same format as the `create-angular-cms-component` skill output (named presets only, no free values).

## Tasks

1. Zod schemas + `buildEntrySchema` with thorough unit tests (each type, required, localised, nested blocks).
2. API `libs/api/content-model`: CRUD for content types and block types under `/v1/management/spaces/:spaceId/environments/:env/...`. Reject a field change that would invalidate existing entries unless `?force=true` and report affected entry count.
3. Admin `libs/admin/schema`:
   - List of content types and block types.
   - Field builder: add field from a type palette, reorder with CDK drag-drop, edit field settings in a side panel, live JSON preview for developers.
   - Hidden from client roles entirely (route guard + menu).
4. Seed: a `page` type (`title`, `slug`, `seo` group, `body` blocks field) and block types `hero`, `richText`, `image`, `featureGrid`, `cta` matching the blocks in package 10.

## Out of scope

Environments UI and schema merge (phase 4), schema-as-code CLI (19).

## Verify

```bash
npm run db:reset && npm run db:test
npx nx test shared-schemas api
npx nx e2e admin-e2e --grep @schema   # create type, add 3 fields, reorder, save, reload, still there
```

## Definition of done

- [ ] `buildEntrySchema` is the single validation path for entry data
- [ ] Developer role can model; editor role cannot see schema screens
- [ ] Seeded page + 5 block types exist after `db:reset`
