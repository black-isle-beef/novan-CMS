# libs/admin

Angular feature libraries for `apps/admin` (`auth`, `spaces`, `shell`, `dashboard`, `schema`, `content`, `fields`, `editor`, `media`, `settings`, ...).
They are generated here by the build package that introduces the feature (see `docs/build/`), for example:

```bash
npx nx g @nx/angular:lib libs/admin/<feature> --name=admin-<feature> --importPath=@novan/admin-<feature> \
  --prefix=nv --style=scss --changeDetection=OnPush --unitTestRunner=vitest-angular \
  --tags="scope:admin,type:feature"
```

Then delete the generated sample component (and its `.scss`: styles come from the design system). If the generator
refuses `vitest-angular` for a non-buildable library, copy `project.json` and the `tsconfig*.json` files of an
existing lib (`libs/admin/settings`) instead, and add the path to `tsconfig.base.json`.

Every lib is lazy loaded: `apps/admin/src/app/app.routes.ts` reaches each one through `loadChildren`. Code the app
imports statically (bootstrap providers) belongs in `@novan/admin-auth`, which has no UI; importing another lib's
barrel there pulls its screens and the design system into the initial bundle.

Admin libs are not buildable: only `apps/admin` consumes them, and a buildable lib could not import the
non-buildable `@novan/shared-schemas` (`enforceBuildableLibDependency`).

Rules (`docs/build/00-conventions.md`):

- Standalone components, signals, `OnPush`, `@if`/`@for`, `inject()`; styles from the Novan Design System.
- Tag every lib `scope:admin` plus a `type:*` tag. Admin libs may import `scope:admin` and `scope:shared` only, never `scope:api`.
- Supabase is used here only for auth (`@supabase/auth-js`, in `admin-auth`), storage (`@supabase/storage-js`, in
  `admin-media`) and later realtime: its parts, not the whole `supabase-js` client, to keep the initial bundle small.
  Never the service-role key.
- UI must pass the `angular-accessibility-audit-remediator` and `angular-scss-compliance-remediator` skills.
