import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { existsSync } from 'node:fs';
import { AppModule } from './app/app.module';

// Local development reads .env.local (never committed); deployed environments inject variables.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const port = Number(process.env['API_PORT'] ?? process.env['PORT'] ?? 3000);
  await app.listen(port);
  Logger.log(`Novan API listening on http://localhost:${port}`);
}

void bootstrap();
