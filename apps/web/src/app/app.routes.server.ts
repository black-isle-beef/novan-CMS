import { RenderMode, type ServerRoute } from '@angular/ssr';

// Rendered per request so one image serves every environment (its addresses come from the server's environment),
// then cached at the edge (server/cache-policy.ts). `/health`, `/sitemap.xml` and `/robots.txt` are Express routes
// in server.ts, not Angular ones.
export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
    renderMode: RenderMode.Server,
  },
];
