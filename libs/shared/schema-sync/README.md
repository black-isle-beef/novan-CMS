# @novan/schema-sync

Content models as code, without Node: parse schema files, diff them against a space and push the changes. Used by the CLI (`tools/novan-cli`, which reads the files from disk) and the admin's "Set up from GitHub" page (which gets them from the API).

- `schema-files.ts`: `toContentTypeFile`, `toBlockTypeFile`, `fromRemote` (the space's model in file form), `fromFiles` (a schema directory's files, from anywhere).
- `diff.ts`: `diffSchemas`, `formatChanges`.
- `push.ts`: `applyChanges` through any `SchemaWriter` (the CLI's `NovanApi`, or an adapter over the admin's `SchemaApi`).

```bash
npx nx test shared-schema-sync
```
