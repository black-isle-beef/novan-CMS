# libs/admin

Angular feature libraries for `apps/admin` (`auth`, `spaces`, `schema`, `content`, `fields`, `editor`, `media`, `users`, `settings`, ...).
They are generated here by the build package that introduces the feature (see `docs/build/`), for example:

```bash
npx nx g @nx/angular:lib libs/admin/<feature> --name=admin-<feature> --importPath=@novan/admin-<feature> \
  --buildable --prefix=nv --style=scss --changeDetection=OnPush --unitTestRunner=vitest-angular \
  --tags="scope:admin,type:feature"
```

Rules (`docs/build/00-conventions.md`):

- Standalone components, signals, `OnPush`, `@if`/`@for`, `inject()`; styles from the Novan Design System.
- Tag every lib `scope:admin` plus a `type:*` tag. Admin libs may import `scope:admin` and `scope:shared` only, never `scope:api`.
- `supabase-js` is used here only for auth, storage uploads and realtime. Never the service-role key.
- UI must pass the `angular-accessibility-audit-remediator` and `angular-scss-compliance-remediator` skills.
