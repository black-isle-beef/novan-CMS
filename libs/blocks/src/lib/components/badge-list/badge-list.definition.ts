// components/badge-list/badge-list.definition.ts
import { defineCmsComponent } from '../../cms-registry';
import { BadgeListBlock } from './badge-list.component';
import { BADGE_LIST_SAMPLE_CONTENT, BADGE_LIST_SCHEMA } from './badge-list.schema';

export const BADGE_LIST_DEFINITION = defineCmsComponent({
  type: 'badgeList',
  name: 'Badge list',
  component: BadgeListBlock,
  fields: { heading: 'text', intro: 'text', badges: { type: 'group', multiple: true, fields: { label: 'text' } } },
  settingsSchema: BADGE_LIST_SCHEMA,
  sampleContent: BADGE_LIST_SAMPLE_CONTENT,
  parts: ['root', 'inner', 'heading', 'intro', 'list', 'badge'],
});
