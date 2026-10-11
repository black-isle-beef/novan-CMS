import { Module } from '@nestjs/common';
import { AuthModule } from '@novan/api-auth';
import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';

/** The audit log screen's routes (docs/build/18-search-forms-audit.md). */
@Module({
  imports: [AuthModule],
  controllers: [AuditLogController],
  providers: [AuditLogService],
})
export class AuditLogModule {}
