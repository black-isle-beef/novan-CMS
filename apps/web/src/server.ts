import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import { DEFAULT_PROXY_PATH } from '@black-isle-beef/cms-angular';
import { createNovanProxy } from '@black-isle-beef/cms-angular/server';
import { pages } from '@novan/marketing-content';
import compression from 'compression';
import express from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NO_STORE, withCachePolicy } from './server/cache-policy';
import { robotsTxt, sitemapXml } from './server/seo-files';
import { allowedHosts, siteUrl, webServerConfig } from './web.server';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

const config = webServerConfig();
const app = express();
// Behind Caddy and Cloudflare (package 20): the visitor's address, which the form proxy passes on to the API's spam
// checks, comes from X-Forwarded-For. TRUST_PROXY is the number of proxies in front (2 for Cloudflare and Caddy).
const trustProxy = process.env['TRUST_PROXY'];
if (trustProxy) app.set('trust proxy', Number(trustProxy) || trustProxy);
app.use(compression());
const angularApp = new AngularNodeAppEngine({ allowedHosts: allowedHosts() });
const origin = (req: express.Request) => siteUrl(config, `${req.protocol}://${req.get('host')}`);

/** Liveness for the container platform and uptime checks; never cached. */
app.get('/health', (_req, res) => {
  res.set('Cache-Control', NO_STORE).json({ status: 'ok', version: process.env['APP_VERSION'] ?? null });
});

/** Every page but the 404. It changes only with a deploy, so caches may keep it for a day. */
app.get('/sitemap.xml', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.type('application/xml; charset=utf-8').send(sitemapXml(origin(req), Object.values(pages).map((page) => page.path)));
});

app.get('/robots.txt', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.type('text/plain').send(robotsTxt(origin(req), DEFAULT_PROXY_PATH));
});

/**
 * Enquiries from the contact page, sent to the Forms feature with the Novan space's delivery token, which stays on
 * the server. Only form submissions pass: the marketing site reads no content through the proxy.
 */
const forms = express.Router();
forms.post('/delivery/forms/:formUid/submit', createNovanProxy({ apiUrl: config.apiUrl, deliveryToken: config.deliveryToken }));
app.use(DEFAULT_PROXY_PATH, forms);

/** Hashed scripts, styles and fonts, and the logos. */
app.use(express.static(browserDistFolder, { maxAge: '1y', index: false, redirect: false }));

/** Every other address is rendered by Angular; unknown ones get the branded 404 page. */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => (response ? withCachePolicy(response) : null))
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is run via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build).
 */
export const reqHandler = createNodeRequestHandler(app);
