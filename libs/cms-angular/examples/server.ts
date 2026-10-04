import { AngularNodeAppEngine, createNodeRequestHandler, writeResponseToNodeResponse } from '@angular/ssr/node';
import { createNovanProxy } from '@novan/cms-angular/server';
import express from 'express';
import { novanServerOptions } from './novan.server';

const app = express();
const angularApp = new AngularNodeAppEngine();

// The browser reads content through here after the first page; the proxy adds the token.
app.use('/_novan', createNovanProxy(novanServerOptions));

app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

export const reqHandler = createNodeRequestHandler(app);
