import { AngularNodeAppEngine, createNodeRequestHandler, writeResponseToNodeResponse } from '@angular/ssr/node';
import { createNovanNotFoundReporter, createNovanProxy, createNovanRedirects } from '@black-isle-beef/cms-angular/server';
import express from 'express';
import { novanServerOptions } from './novan.server';

const app = express();
const angularApp = new AngularNodeAppEngine();
const redirects = createNovanRedirects(novanServerOptions);
const reportNotFound = createNovanNotFoundReporter(novanServerOptions);

// The browser reads content through here after the first page; the proxy adds the token.
app.use('/_novan', createNovanProxy(novanServerOptions));

// Old addresses redirect before anything renders: the CMS's redirects, and pages whose address changed.
app.use((req, res, next) => void redirects.handle(req, res, next));

app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => {
      if (!response) return next();
      // Editors see addresses with no page among the top 404s, and can redirect them.
      if (response.status === 404) void reportNotFound(req.path, req.get('referer'));
      return writeResponseToNodeResponse(response, res);
    })
    .catch(next);
});

export const reqHandler = createNodeRequestHandler(app);
