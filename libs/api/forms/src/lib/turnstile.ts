import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { badRequest, ProblemException } from '@novan/api-common';

export const TURNSTILE_CONFIG = Symbol('TURNSTILE_CONFIG');

export interface TurnstileConfig {
  /** Cloudflare Turnstile's secret key for the sites' widgets (`TURNSTILE_SECRET_KEY`). */
  secretKey: string;
  /** Without a secret key, forms are refused (production) or accepted unchecked (development and tests). */
  requireKey: boolean;
  /** Replaced in tests. */
  fetch?: typeof fetch;
}

export function turnstileConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TurnstileConfig {
  return { secretKey: env['TURNSTILE_SECRET_KEY'] ?? '', requireKey: env['NODE_ENV'] === 'production' };
}

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5000;

/**
 * Checks a form's Cloudflare Turnstile response with Cloudflare (docs/build/18-search-forms-audit.md), so robots cannot
 * send forms. Each response can be checked once. Cloudflare's test keys (`1x0000000000000000000000000000000AA` always
 * passes, `2x0000000000000000000000000000000AA` always fails) work locally.
 */
@Injectable()
export class TurnstileVerifier {
  private readonly logger = new Logger(TurnstileVerifier.name);
  private warned = false;

  constructor(@Inject(TURNSTILE_CONFIG) private readonly config: TurnstileConfig) {}

  /** Resolves when the response is genuine; otherwise throws 400 `spam_check_failed` (or 503 when it cannot check). */
  async verify(token: string | undefined, clientIp: string | null): Promise<void> {
    if (!this.config.secretKey) {
      if (this.config.requireKey) {
        throw new ProblemException(HttpStatus.SERVICE_UNAVAILABLE, 'forms_unavailable', 'Forms are not set up', 'Forms cannot be sent yet. Please try again later.');
      }
      if (!this.warned) this.logger.warn('TURNSTILE_SECRET_KEY is not set: form submissions are accepted without a spam check.');
      this.warned = true;
      return;
    }
    if (!token) throw failed();

    const body = new URLSearchParams({ secret: this.config.secretKey, response: token });
    if (clientIp) body.set('remoteip', clientIp);
    let outcome: { success?: unknown; 'error-codes'?: unknown };
    try {
      const response = await (this.config.fetch ?? fetch)(SITEVERIFY, { method: 'POST', body, signal: AbortSignal.timeout(TIMEOUT_MS) });
      outcome = (await response.json()) as typeof outcome;
    } catch (error) {
      this.logger.warn(`Cloudflare Turnstile could not be reached: ${String(error)}`);
      throw new ProblemException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'spam_check_unavailable',
        'Spam check unavailable',
        'The form could not be checked just now. Please try again in a minute.',
      );
    }
    if (outcome.success !== true) throw failed();
  }
}

const failed = () => badRequest('spam_check_failed', 'Complete the check that you are not a robot, then send the form again.');
