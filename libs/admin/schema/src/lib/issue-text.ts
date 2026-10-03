import type { FieldDef } from '@novan/shared-schemas';

/** A validation issue from the shared Zod schemas, or from the API's problem `errors`. */
export interface Issue {
  path: readonly PropertyKey[];
  message: string;
}

const keyLabels: Record<string, string> = {
  apiId: 'API id',
  name: 'Name',
  label: 'Label',
  help: 'Help text',
  kind: 'Kind',
  icon: 'Icon',
  description: 'Description',
  hidden: 'Hidden from editors',
  pattern: 'Pattern',
  min: 'Minimum',
  max: 'Maximum',
  options: 'Options',
  accept: 'Accepts',
  marks: 'Formatting',
  nodes: 'Elements',
  multiple: 'Repeatable',
  allowedBlocks: 'Allowed blocks',
  allowedChildren: 'Allowed child blocks',
  contentTypes: 'Content types',
  styleOptions: 'Style options',
  fields: 'Fields',
};

/** "Title › API id: Use camelCase..." for an issue at `fields.0.apiId`. */
export function describeIssue(issue: Issue, fields: readonly FieldDef[]): string {
  const parts: string[] = [];
  let level: readonly FieldDef[] | undefined = fields;
  const path = [...issue.path];

  while (path.length) {
    const key = path.shift();
    const index = path[0];
    if (key === 'fields' && level && typeof index === 'number') {
      path.shift();
      const field: FieldDef | undefined = level[index];
      parts.push(field ? field.label || `Field ${index + 1}` : `Field ${index + 1}`);
      level = field?.type === 'group' ? field.fields : undefined;
    } else if (typeof key === 'string' && key in keyLabels) {
      parts.push(keyLabels[key]);
    } else if (typeof key === 'number') {
      parts.push(`item ${key + 1}`);
    } else if (key !== undefined && key !== '') {
      parts.push(String(key));
    }
  }
  return parts.length ? `${parts.join(' › ')}: ${issue.message}` : issue.message;
}

/** Issues from an API `validation_failed` / `unknown_reference` problem (`errors` keyed by dotted path). */
export function issuesFromErrors(errors: Record<string, string[]>): Issue[] {
  return Object.entries(errors).flatMap(([path, messages]) =>
    messages.map((message) => ({
      path: path === '(root)' ? [] : path.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part)),
      message,
    })),
  );
}
