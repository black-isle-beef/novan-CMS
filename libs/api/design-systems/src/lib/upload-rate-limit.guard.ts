import { type CanActivate, type ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedRequest } from '@novan/api-auth';
import { ProblemException } from '@novan/api-common';
import { DESIGN_SYSTEMS_CONFIG, type DesignSystemsConfig } from './design-systems-config';

const WINDOW_MS = 10 * 60_000;

/**
 * Holds back one person starting uploads or fetches over and over: each is processed by the worker and stored, so
 * a loop would fill the queue and the bucket. Counted per person in memory, per API instance.
 */
@Injectable()
export class UploadRateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(@Inject(DESIGN_SYSTEMS_CONFIG) private readonly config: DesignSystemsConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) return true;
    const now = Date.now();
    const window = this.windows.get(user.id);
    if (!window || now - window.start >= WINDOW_MS) {
      this.windows.set(user.id, { start: now, count: 1 });
      this.forgetOld(now);
      return true;
    }
    if (window.count >= this.config.uploadsPerTenMinutes) {
      throw new ProblemException(
        HttpStatus.TOO_MANY_REQUESTS,
        'rate_limited',
        'Too many requests',
        'Too many uploads. Wait a few minutes, then try again.',
      );
    }
    window.count++;
    return true;
  }

  private forgetOld(now: number): void {
    if (this.windows.size < 1000) return;
    for (const [id, window] of this.windows) if (now - window.start >= WINDOW_MS) this.windows.delete(id);
  }
}
