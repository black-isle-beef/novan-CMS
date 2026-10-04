import { Controller, Get, Header, Inject } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { buildOpenApiDocument, type OpenApiDocument } from '@novan/api-common';
import { APP_VERSION } from '../app-version';

/** The OpenAPI document for the management, delivery and preview APIs, built once from the routes. */
@Controller('v1/docs')
export class DocsController {
  private document?: OpenApiDocument;

  constructor(
    private readonly discovery: DiscoveryService,
    @Inject(APP_VERSION) private readonly version: string,
  ) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=300')
  get(): OpenApiDocument {
    this.document ??= buildOpenApiDocument(this.discovery.getControllers(), {
      title: 'Novan CMS API',
      version: this.version,
      description:
        'Management (`/v1/management`, a signed-in admin session), Delivery (`/v1/delivery`, a delivery token: published ' +
        'content, cached by the CDN) and Preview (`/v1/preview`, a preview token: current drafts, never cached). ' +
        'Delivery `GET entries` also takes field filters, `fields.<field>[eq|in|lt|gt]=<value>`, which need `type`. ' +
        'Errors are RFC 9457 problem details with a stable `code`.',
    });
    return this.document;
  }
}
