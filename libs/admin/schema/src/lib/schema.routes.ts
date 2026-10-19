import type { Route } from '@angular/router';
import { requireSchemaAccess, requireSchemaFromGithub } from './schema-access';

const editor = () => import('./type-editor-page/type-editor-page').then((m) => m.TypeEditorPage);

/** Schema screens, inside the signed-in layout. Hidden from client roles (guard here, link in the shell). */
export const schemaRoutes: Route[] = [
  {
    path: 'spaces/:spaceId/schema',
    title: 'Schema | Novan CMS',
    canActivate: [requireSchemaAccess],
    loadComponent: () => import('./schema-page/schema-page').then((m) => m.SchemaPage),
  },
  {
    path: 'spaces/:spaceId/schema/from-github',
    title: 'Set up from GitHub | Novan CMS',
    canActivate: [requireSchemaFromGithub],
    loadComponent: () => import('./github-setup-page/github-setup-page').then((m) => m.GithubSetupPage),
  },
  {
    path: 'spaces/:spaceId/schema/new/content-type',
    title: 'New content type | Novan CMS',
    canActivate: [requireSchemaAccess],
    data: { kind: 'content-types' },
    loadComponent: editor,
  },
  {
    path: 'spaces/:spaceId/schema/new/block-type',
    title: 'New block type | Novan CMS',
    canActivate: [requireSchemaAccess],
    data: { kind: 'block-types' },
    loadComponent: editor,
  },
  {
    path: 'spaces/:spaceId/schema/content-types/:apiId',
    title: 'Content type | Novan CMS',
    canActivate: [requireSchemaAccess],
    data: { kind: 'content-types' },
    loadComponent: editor,
  },
  {
    path: 'spaces/:spaceId/schema/block-types/:apiId',
    title: 'Block type | Novan CMS',
    canActivate: [requireSchemaAccess],
    data: { kind: 'block-types' },
    loadComponent: editor,
  },
];
