# libs/api

NestJS feature libraries for `apps/api`, one per feature (`auth`, `spaces`, `content`, `media`, `delivery`, ...).
They are generated here by the build package that introduces the feature (see `docs/build/`), for example:

```bash
npx nx g @nx/nest:lib libs/api/<feature> --name=api-<feature> --importPath=@novan/api-<feature> \
  --unitTestRunner=vitest --tags="scope:api,type:feature"
```

Rules (`docs/build/00-conventions.md`):

- One Nest module per feature; no business logic in controllers; DTOs validated with Zod from `@novan/shared-schemas`.
- Tag every lib `scope:api` plus a `type:*` tag. Lint fails if anything outside `scope:api` imports these libs.
- Use Vitest with `unplugin-swc` (copy `apps/api/vitest.config.mts`) so decorator metadata is emitted.
