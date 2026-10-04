import { badRequest } from '@novan/api-common';
import type { FieldDef, FieldFilter } from '@novan/shared-schemas';
import { type SQL, sql } from 'drizzle-orm';
import type { ContentSource } from './content-source';

// Field filters, sorting and keyset pagination for `GET entries`. Every value reaches Postgres as a bound
// parameter; field names are checked against the content type before they are used.

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string): boolean => uuidPattern.test(value);

type Cast = 'numeric' | 'timestamptz' | 'text';

/** A field filters and sorts as a single value, or as a list it can only be matched against. */
function fieldShape(field: FieldDef): { kind: 'scalar'; cast: Cast; ordered: boolean } | { kind: 'list' } | null {
  switch (field.type) {
    case 'number':
      return { kind: 'scalar', cast: 'numeric', ordered: true };
    case 'text':
    case 'date':
      return { kind: 'scalar', cast: 'text', ordered: true };
    case 'boolean':
      return { kind: 'scalar', cast: 'text', ordered: false };
    case 'select':
    case 'reference':
      return field.multiple ? { kind: 'list' } : { kind: 'scalar', cast: 'text', ordered: false };
    default:
      return null;
  }
}

function findField(fields: readonly FieldDef[], apiId: string, type: string): FieldDef {
  const field = fields.find((f) => f.apiId === apiId);
  if (!field) throw badRequest('unknown_field', `The ${type} type has no field "${apiId}".`);
  return field;
}

/** Checks a filter value against the field's type and returns it as Postgres should compare it. */
function filterValue(field: FieldDef, value: string): string {
  if (field.type === 'number' && (value.trim() === '' || !Number.isFinite(Number(value)))) {
    throw badRequest('invalid_filter', `fields.${field.apiId} is a number; filter it with a number.`);
  }
  if (field.type === 'boolean' && value !== 'true' && value !== 'false') {
    throw badRequest('invalid_filter', `fields.${field.apiId} is true or false; filter it with true or false.`);
  }
  if (field.type === 'reference' && !isUuid(value)) {
    throw badRequest('invalid_filter', `fields.${field.apiId} holds entry ids; filter it with an id.`);
  }
  return value;
}

const typed = (value: string, cast: Cast): SQL =>
  cast === 'numeric' ? sql`${value}::numeric` : cast === 'timestamptz' ? sql`${value}::timestamptz` : sql`${value}`;

export function fieldFilterSql(src: ContentSource, fields: readonly FieldDef[], type: string, filter: FieldFilter): SQL {
  const field = findField(fields, filter.field, type);
  const shape = fieldShape(field);
  if (!shape) throw badRequest('field_not_filterable', `fields.${field.apiId} is a ${field.type} field, which cannot be filtered.`);
  const values = (Array.isArray(filter.value) ? filter.value : [filter.value]).map((value) => filterValue(field, value));
  const list = sql.join(values.map((value) => sql`${value}`), sql`, `);

  if (shape.kind === 'list') {
    const json = sql`(${src.data} -> ${field.apiId})`;
    if (filter.op === 'eq') return sql`${json} @> jsonb_build_array(${values[0]}::text)`;
    if (filter.op === 'in') return sql`${json} ?| array[${list}]::text[]`;
    throw badRequest('invalid_filter', `fields.${field.apiId} holds a list; filter it with eq or in.`);
  }

  const expr = fieldExpr(src, field.apiId, shape.cast);
  switch (filter.op) {
    case 'eq':
      return sql`${expr} = ${typed(values[0], shape.cast)}`;
    case 'in':
      return sql`${expr} in (${sql.join(values.map((value) => typed(value, shape.cast)), sql`, `)})`;
    case 'lt':
    case 'gt':
      if (!shape.ordered) throw badRequest('invalid_filter', `fields.${field.apiId} can only be filtered with eq or in.`);
      return filter.op === 'lt' ? sql`${expr} < ${typed(values[0], shape.cast)}` : sql`${expr} > ${typed(values[0], shape.cast)}`;
  }
}

function fieldExpr(src: ContentSource, apiId: string, cast: Cast): SQL {
  const text = sql`(${src.data} ->> ${apiId})`;
  return cast === 'numeric' ? sql`${text}::numeric` : text;
}

// --- Sorting and cursors ------------------------------------------------------------------------

export interface Sort {
  /** As requested, e.g. `-fields.date`; a cursor only continues the sort it came from. */
  spec: string;
  expr: SQL;
  cast: Cast;
  descending: boolean;
}

export function sortOf(src: ContentSource, spec: string, fields: readonly FieldDef[] | null, type: string | undefined): Sort {
  const descending = spec.startsWith('-');
  const key = descending ? spec.slice(1) : spec;
  if (key === 'updatedAt') return { spec, expr: sql`${src.updatedAt}`, cast: 'timestamptz', descending };
  if (key === 'path') return { spec, expr: sql`${src.path}`, cast: 'text', descending };

  // `fields.<apiId>`; the query schema already asked for `type` alongside it.
  const apiId = key.slice('fields.'.length);
  const field = findField(fields ?? [], apiId, type ?? '');
  const shape = fieldShape(field);
  if (!shape || shape.kind !== 'scalar') {
    throw badRequest('field_not_sortable', `fields.${apiId} is a ${field.type} field, which cannot be sorted.`);
  }
  return { spec, expr: fieldExpr(src, apiId, shape.cast), cast: shape.cast, descending };
}

/** Rows without a value come last either way; equal values are ordered by id. */
export function orderBy(src: ContentSource, sort: Sort): SQL[] {
  return sort.descending
    ? [sql`${sort.expr} desc nulls last`, sql`${src.id} desc`]
    : [sql`${sort.expr} asc nulls last`, sql`${src.id} asc`];
}

interface CursorPosition {
  /** The sort, so a cursor cannot be replayed against another. */
  s: string;
  /** The last row's sort value as text, or null. */
  v: string | null;
  id: string;
}

export function encodeCursor(position: CursorPosition): string {
  return Buffer.from(JSON.stringify(position), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string, sort: Sort): CursorPosition {
  let position: Partial<CursorPosition> | null = null;
  try {
    position = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<CursorPosition>;
  } catch {
    // Reported below.
  }
  if (
    !position ||
    position.s !== sort.spec ||
    typeof position.id !== 'string' ||
    !isUuid(position.id) ||
    !(position.v === null || typeof position.v === 'string')
  ) {
    throw badRequest('invalid_cursor', 'This cursor does not belong to this query. Start again from the first page.');
  }
  if (position.v !== null && sort.cast === 'numeric' && !Number.isFinite(Number(position.v))) {
    throw badRequest('invalid_cursor', 'This cursor does not belong to this query. Start again from the first page.');
  }
  return position as CursorPosition;
}

/** Rows after the cursor's position in {@link orderBy}'s order. */
export function afterCursor(src: ContentSource, sort: Sort, position: CursorPosition): SQL {
  const idAfter = sort.descending ? sql`${src.id} < ${position.id}` : sql`${src.id} > ${position.id}`;
  if (position.v === null) return sql`(${sort.expr} is null and ${idAfter})`;
  const value = typed(position.v, sort.cast);
  const beyond = sort.descending ? sql`${sort.expr} < ${value}` : sql`${sort.expr} > ${value}`;
  return sql`(${sort.expr} is null or ${beyond} or (${sort.expr} = ${value} and ${idAfter}))`;
}
