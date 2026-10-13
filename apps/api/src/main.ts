// Error reporting first, so it can instrument the modules that load after it.
import './instrument';
import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter, type NestExpressApplication } from '@nestjs/platform-express';
import { JobWorker } from '@novan/api-jobs';
import { existsSync } from 'node:fs';
import { AppModule } from './app/app.module';

// Local development reads .env.local (never committed); deployed environments inject variables.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

// `--worker` runs background jobs only (same image, a separate process); `--with-worker` runs them beside the HTTP
// server, as `nx serve api` does. See libs/api/jobs.
const workerOnly = process.argv.includes('--worker');
const withWorker = process.argv.includes('--with-worker');

// Deployed containers log one JSON object a line (LOG_FORMAT=json, set by the image) for the log shipper.
const logger = process.env['LOG_FORMAT'] === 'json' ? new ConsoleLogger({ json: true, colors: false }) : undefined;

async function bootstrap(): Promise<void> {
  if (workerOnly) {
    const context = await NestFactory.createApplicationContext(AppModule, { logger });
    context.enableShutdownHooks();
    context.get(JobWorker).start();
    Logger.log('Novan worker started');
    return;
  }
  // The adapter is named, not left for Nest to load, so the image's pruned package.json includes it.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, new ExpressAdapter(), { logger });
  app.enableShutdownHooks();
  // The admin calls the API from the browser; only its origin may.
  app.enableCors({ origin: process.env['ADMIN_URL'] ?? 'http://localhost:4200' });
  // Behind Caddy and Cloudflare: the client's address and scheme come from X-Forwarded-* (rate limits, logs).
  const trustProxy = process.env['TRUST_PROXY'];
  if (trustProxy) app.set('trust proxy', Number(trustProxy) || trustProxy);
  const port = Number(process.env['API_PORT'] ?? process.env['PORT'] ?? 3000);
  await app.listen(port);
  Logger.log(`Novan API listening on http://localhost:${port}`);
  if (withWorker) app.get(JobWorker).start();
}

void bootstrap();
