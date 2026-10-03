# api-common

HTTP plumbing shared by the API feature libs:

- `ProblemException` and helpers (`forbidden('code')`, ...) plus `ProblemDetailsFilter`, which renders every
  error as RFC 9457 `application/problem+json` with a stable `code`.
- `ZodValidationPipe`: validates bodies and params with schemas from `@novan/shared-schemas`.
