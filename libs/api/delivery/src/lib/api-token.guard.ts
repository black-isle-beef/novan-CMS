import { CanActivate, createParamDecorator, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { forbidden, unauthorized } from '@novan/api-common';
import type { ApiTokenScope } from '@novan/shared-schemas';
import type { Request, Response } from 'express';
import { type ApiTokenAccess, ApiTokenResolver } from './api-token-resolver';
import { NO_STORE } from './cache-headers.interceptor';
import { scopeOfToken } from './token-secret';

const TOKEN_SCOPE = 'novan:apiTokenScope';

export interface ApiTokenRequest extends Request {
  apiToken?: ApiTokenAccess;
}

/** The kind of API token a controller takes. */
export const RequireTokenScope = (scope: ApiTokenScope): ClassDecorator & MethodDecorator => SetMetadata(TOKEN_SCOPE, scope);

/** The space and environment the request's token reads. */
export const TokenAccess = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): ApiTokenAccess => ctx.switchToHttp().getRequest<ApiTokenRequest>().apiToken as ApiTokenAccess,
);

const otherApi: Record<ApiTokenScope, string> = { delivery: '/v1/delivery', preview: '/v1/preview' };

/**
 * Checks `Authorization: Bearer nv_del_…` (or `nv_pre_…` on the Preview API) and exposes what it gives
 * access to as `req.apiToken`. The space and environment always come from the token, never the URL.
 */
@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(
    private readonly tokens: ApiTokenResolver,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const scope = this.reflector.getAllAndOverride<ApiTokenScope>(TOKEN_SCOPE, [context.getHandler(), context.getClass()]);
    const req = context.switchToHttp().getRequest<ApiTokenRequest>();
    // Until a response succeeds (CacheHeadersInterceptor), nothing may be cached: not 401s, 429s or 404s.
    context.switchToHttp().getResponse<Response>().setHeader('Cache-Control', NO_STORE);
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw unauthorized('missing_token', `Send a ${scope} token as a Bearer token.`);
    }

    // The prefix is checked before the database, so made-up tokens cost nothing.
    const claimed = scopeOfToken(token);
    if (!claimed) throw unauthorized('invalid_token', 'The API token is invalid or has been revoked.');
    if (claimed !== scope) {
      throw forbidden('wrong_token_scope', `This is a ${claimed} token. Use it with ${otherApi[claimed]}.`);
    }

    const access = await this.tokens.resolve(token);
    if (!access || access.scope !== scope) throw unauthorized('invalid_token', 'The API token is invalid or has been revoked.');
    req.apiToken = access;
    return true;
  }
}
