import type { Route } from '@angular/router';

/** The media library, inside the signed-in layout. Every member can open it; roles decide what they can change. */
export const mediaRoutes: Route[] = [
  {
    path: 'spaces/:spaceId/media',
    title: 'Media | Novan CMS',
    loadComponent: () => import('./media-library-page/media-library-page').then((m) => m.MediaLibraryPage),
  },
];
