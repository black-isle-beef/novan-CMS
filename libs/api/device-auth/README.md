# api-device-auth

Device sign-in for the Novan CLI (`novan login`), after RFC 8628. See `docs/build/19-schema-cli-starter-kits.md`.

- `POST /v1/auth/device-authorizations` — the CLI asks for a device code and a user code.
- `POST /v1/auth/device-authorizations/token` — the CLI polls until the code is approved, then gets a one-time
  magic-link token hash to swap with Supabase Auth for a session of its own.
- `POST /v1/management/device-authorizations/decide` — the signed-in person approves or denies the code at
  `<ADMIN_URL>/device`.

Run the tests with `npx nx test api-device-auth`.
