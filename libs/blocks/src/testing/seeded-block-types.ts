// testing/seeded-block-types.ts — the block types `supabase/seed.sql` creates, read from the seed itself so
// `block-types.spec.ts` fails as soon as a component and its seeded definition drift apart.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface SeededField {
  apiId: string;
  type: string;
  required: boolean;
  multiple?: boolean;
  options?: { value: string; label: string }[];
  fields?: SeededField[];
  [prop: string]: unknown;
}

export interface SeededBlockType {
  apiId: string;
  name: string;
  icon: string;
  fields: SeededField[];
  styleOptions: Record<string, unknown>;
}

/** One `('apiId', 'Name', 'icon', $json$[fields]$json$::jsonb, $json${style options}$json$::jsonb)` row. */
const ROW = /\('([a-zA-Z0-9]+)', '([^']+)', '([a-z0-9-]+)', \$json\$(\[[\s\S]*?\])\$json\$::jsonb, \$json\$(\{[\s\S]*?\})\$json\$::jsonb\)/g;

export function seededBlockTypes(): SeededBlockType[] {
  // Tests run from the workspace root.
  const sql = readFileSync(resolve('supabase/seed.sql'), 'utf8');
  const start = sql.indexOf('insert into public.block_types');
  if (start < 0) throw new Error('supabase/seed.sql no longer seeds public.block_types');
  const end = sql.indexOf(') as b (api_id', start);
  return [...sql.slice(start, end).matchAll(ROW)].map(([, apiId, name, icon, fields, styleOptions]) => ({
    apiId,
    name,
    icon,
    fields: JSON.parse(fields) as SeededField[],
    styleOptions: JSON.parse(styleOptions) as Record<string, unknown>,
  }));
}
