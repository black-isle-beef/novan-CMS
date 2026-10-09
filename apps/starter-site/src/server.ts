import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import { DEFAULT_PROXY_PATH, type NovanSitemap, PREVIEW_PARAM } from '@black-isle-beef/cms-angular';
import { createNovanNotFoundReporter, createNovanProxy, createNovanRedirects } from '@black-isle-beef/cms-angular/server';
import compression from 'compression';
import express from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowedHosts, novanServerOptions, redirectsMaxAge, siteUrl } from './novan.server';
import { CMS_PAGE_CACHE_CONTROL, NO_STORE, withCachePolicy } from './server/cache-policy';
import { robotsTxt, sitemapXml } from './server/sitemap';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

const app = express();
// Pages, scripts and styles are sent compressed; the CDN keeps (and passes on) the compressed copy.
app.use(compression());
const angularApp = new AngularNodeAppEngine({ allowedHosts: allowedHosts() });
const redirects = createNovanRedirects({ ...novanServerOptions, maxAgeMs: redirectsMaxAge() });
const reportNotFound = createNovanNotFoundReporter(novanServerOptions);

/** Liveness for the container platform and uptime checks; never cached. */
app.get('/health', (_req, res) => {
  res.set('Cache-Control', NO_STORE).json({ status: 'ok' });
});

/** Built from the Delivery API's sitemap and cached under its tags, so publishing a page refreshes it. */
app.get('/sitemap.xml', async (req, res) => {
  try {
    const api = await fetch(`${novanServerOptions.apiUrl.replace(/\/+$/, '')}/v1/delivery/sitemap`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${novanServerOptions.deliveryToken}` },
    });
    if (!api.ok) throw new Error(`The Delivery API answered ${api.status}.`);
    const xml = sitemapXml(siteUrl(`${req.protocol}://${req.get('host')}`), (await api.json()) as NovanSitemap);
    const tags = api.headers.get('Cache-Tag');
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', tags ? CMS_PAGE_CACHE_CONTROL : NO_STORE);
    if (tags) res.set('Cache-Tag', tags);
    res.send(xml);
  } catch (error) {
    console.error('sitemap.xml could not be built.', error);
    res.status(503).set('Cache-Control', NO_STORE).type('text/plain').send('The sitemap is not available right now.');
  }
});

/** Points crawlers at the sitemap. It changes only with the site's address, so caches may keep it for a day. */
app.get('/robots.txt', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.type('text/plain').send(robotsTxt(siteUrl(`${req.protocol}://${req.get('host')}`), DEFAULT_PROXY_PATH));
});

/**
 * Content for the browser after the first page: the proxy adds the API token, which stays on the server.
 */
app.use(DEFAULT_PROXY_PATH, createNovanProxy(novanServerOptions));

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Old addresses redirect before anything renders: the CMS's redirects, and the 301s it makes when a published page's
 * address changes (docs/build/14-seo-site-features.md). Cached at the edge under the API's tags.
 */
app.use((req, res, next) => void redirects.handle(req, res, next));

/**
 * Every other address is a CMS page, rendered by Angular. Its caching headers come from the render: see
 * `withCachePolicy`. An address with no page is reported to the CMS, which lists the most visited for editors
 * to redirect (previews and the editor's frame are not visits).
 */
app.use('/**', (req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => {
      if (!response) return next();
      // `req.path` is relative to this route's mount, so the address comes from `originalUrl`.
      if (response.status === 404 && !(PREVIEW_PARAM in req.query)) void reportNotFound(req.originalUrl.split('?')[0], req.get('referer'));
      return writeResponseToNodeResponse(withCachePolicy(response), res);
    })
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
