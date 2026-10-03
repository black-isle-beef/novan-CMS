import { RenderMode, ServerRoute } from '@angular/ssr';

// CMS pages change on publish, so they render per request (cached at the edge) rather than prerendering.
export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
    renderMode: RenderMode.Server,
  },
];
