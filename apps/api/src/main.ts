import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JobWorker } from '@novan/api-jobs';
import { existsSync } from 'node:fs';
import { AppModule } from './app/app.module';

// Local development reads .env.local (never committed); deployed environments inject variables.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

// `--worker` runs background jobs only (same image, a separate process); `--with-worker` runs them beside the HTTP
// server, as `nx serve api` does. See libs/api/jobs.
const workerOnly = process.argv.includes('--worker');
const withWorker = process.argv.includes('--with-worker');

async function bootstrap(): Promise<void> {
  if (workerOnly) {
    const context = await NestFactory.createApplicationContext(AppModule);
    context.enableShutdownHooks();
    context.get(JobWorker).start();
    Logger.log('Novan worker started');
    return;
  }
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  // The admin calls the API from the browser; only its origin may.
  app.enableCors({ origin: process.env['ADMIN_URL'] ?? 'http://localhost:4200' });
  const port = Number(process.env['API_PORT'] ?? process.env['PORT'] ?? 3000);
  await app.listen(port);
  Logger.log(`Novan API listening on http://localhost:${port}`);
  if (withWorker) app.get(JobWorker).start();
}

void bootstrap();
