import { fieldListSchema } from '@novan/shared-schemas';
import { describeIssue, issuesFromErrors } from './issue-text';

const fields = fieldListSchema.parse([
  { id: 'title', apiId: 'title', label: 'Title', type: 'text' },
  {
    id: 'seo',
    apiId: 'seo',
    label: 'SEO',
    type: 'group',
    fields: [{ id: 'meta', apiId: 'metaTitle', label: 'Search title', type: 'text' }],
  },
]);

describe('describeIssue', () => {
  it('names fields by their label, including inside groups', () => {
    expect(describeIssue({ path: ['fields', 0, 'apiId'], message: 'Use camelCase.' }, fields)).toBe(
      'Title › API id: Use camelCase.',
    );
    expect(describeIssue({ path: ['fields', 1, 'fields', 0, 'max'], message: 'Too small.' }, fields)).toBe(
      'SEO › Search title › Maximum: Too small.',
    );
    expect(describeIssue({ path: ['fields', 7, 'label'], message: 'Required.' }, fields)).toBe('Field 8 › Label: Required.');
  });

  it('labels top-level properties and keeps root messages as they are', () => {
    expect(describeIssue({ path: ['name'], message: 'Required.' }, fields)).toBe('Name: Required.');
    expect(describeIssue({ path: [], message: 'Send at least one property.' }, fields)).toBe('Send at least one property.');
  });
});

describe('issuesFromErrors', () => {
  it('turns API problem errors into issues with numeric indexes', () => {
    expect(issuesFromErrors({ 'fields.0.allowedBlocks.1': ['No such block.'], '(root)': ['Bad.'] })).toEqual([
      { path: ['fields', 0, 'allowedBlocks', 1], message: 'No such block.' },
      { path: [], message: 'Bad.' },
    ]);
  });
});
