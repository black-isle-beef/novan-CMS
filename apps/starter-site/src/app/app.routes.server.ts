import { RenderMode, type ServerRoute } from '@angular/ssr';

// CMS pages change on publish, so they render per request (cached at the edge until purged) rather than
// prerendering. `/health`, `/sitemap.xml` and `/robots.txt` are Express routes in server.ts, not Angular ones.
export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
    renderMode: RenderMode.Server,
  },
];
