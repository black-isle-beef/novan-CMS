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
import { withoutFontPreloads } from './server/font-preloads';
import { reportServerErrors, startMonitoring } from './server/monitoring';
import { reportsRedirect } from './server/reports-redirect';
import { type RssPost, rssXml } from './server/rss';
import { robotsTxt, sitemapXml } from './server/sitemap';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

const monitored = startMonitoring();
const app = express();
// Behind Caddy and Cloudflare (package 20): the visitor's address, which the proxy passes on to the API's form spam
// checks, comes from X-Forwarded-For. TRUST_PROXY is the number of proxies in front (2 for Cloudflare and Caddy).
const trustProxy = process.env['TRUST_PROXY'];
if (trustProxy) app.set('trust proxy', Number(trustProxy) || trustProxy);
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

/**
 * The blog's feed (the blog starter kit, kits/blog): the 20 newest `post` entries. A site without posts answers 404.
 * Cached under the API's tags, so publishing a post refreshes it.
 */
app.get('/rss.xml', async (req, res) => {
  const api = novanServerOptions.apiUrl.replace(/\/+$/, '');
  const get = (path: string) =>
    fetch(`${api}/v1/delivery/${path}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${novanServerOptions.deliveryToken}` } });
  try {
    const [posts, settings] = await Promise.all([
      get('entries?type=post&sort=-fields.publishedOn&limit=20&select=fields.title,fields.summary,fields.publishedOn'),
      get('singletons/siteSettings?select=fields.siteName'),
    ]);
    // A space without the `post` type has no blog.
    if (posts.status === 404) {
      res.status(404).set('Cache-Control', NO_STORE).type('text/plain').send('This site has no blog feed.');
      return;
    }
    if (!posts.ok) throw new Error(`The Delivery API answered ${posts.status}.`);
    const page = (await posts.json()) as { items: RssPost[] };
    const site = settings.ok ? ((await settings.json()) as { locale?: string; data?: { siteName?: unknown } }) : null;
    const url = siteUrl(`${req.protocol}://${req.get('host')}`);
    const siteName = typeof site?.data?.siteName === 'string' && site.data.siteName.trim() ? site.data.siteName.trim() : url;
    const xml = rssXml(url, { title: siteName, path: '/blog', locale: site?.locale ?? page.items[0]?.locale ?? 'en-GB' }, page.items);
    const tags = [...new Set([posts, settings].flatMap((answer) => answer.headers.get('Cache-Tag')?.split(',') ?? []))].join(',');
    res.set('Content-Type', 'application/rss+xml; charset=utf-8');
    res.set('Cache-Control', tags ? CMS_PAGE_CACHE_CONTROL : NO_STORE);
    if (tags) res.set('Cache-Tag', tags);
    res.send(xml);
  } catch (error) {
    console.error('rss.xml could not be built.', error);
    res.status(503).set('Cache-Control', NO_STORE).type('text/plain').send('The feed is not available right now.');
  }
});

/** Points crawlers at the sitemap. It changes only with the site's address, so caches may keep it for a day. */
app.get('/robots.txt', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.type('text/plain').send(robotsTxt(siteUrl(`${req.protocol}://${req.get('host')}`), DEFAULT_PROXY_PATH));
});

/** Grooming reports and the staff area live on the Firebase reports app (`REPORTS_ORIGIN`): see reports-redirect.ts. */
app.use((req, res, next) => {
  const target = reportsRedirect(req.originalUrl, process.env['REPORTS_ORIGIN']);
  if (!target) return next();
  res.set('Cache-Control', 'public, max-age=86400').redirect(301, target);
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
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => {
      if (!response) return next();
      // `req.path` is relative to this route's mount, so the address comes from `originalUrl`.
      if (response.status === 404 && !(PREVIEW_PARAM in req.query)) void reportNotFound(req.originalUrl.split('?')[0], req.get('referer'));
      return withoutFontPreloads(withCachePolicy(response)).then((page) => writeResponseToNodeResponse(page, res));
    })
    .catch(next);
});

// Errors the routes above pass on go to Sentry, then to Express's own handler.
if (monitored) reportServerErrors(app);

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
