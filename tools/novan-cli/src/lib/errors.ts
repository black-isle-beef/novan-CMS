// The CLI's errors are the schema-sync library's, so failures from a push print the same way as the CLI's own.
export { ApiError, SchemaSyncError as CliError } from '@novan/schema-sync';
