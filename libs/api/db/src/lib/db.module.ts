import { Global, Module } from '@nestjs/common';
import { DATABASE_URL, DbService } from './db.service';

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_URL,
      useFactory: (): string => {
        const url = process.env['DATABASE_URL'];
        if (!url) throw new Error('DATABASE_URL is not set (see .env.example)');
        return url;
      },
    },
    DbService,
  ],
  exports: [DbService],
})
export class DbModule {}
