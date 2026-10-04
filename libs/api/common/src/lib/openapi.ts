import { RequestMethod, SetMetadata } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

const API_RESPONSE = 'novan:apiResponse';

interface ApiResponseMeta {
  schema: z.ZodType | null;
  status?: number;
}

/**
 * Documents what a route answers, for the OpenAPI document at `/v1/docs`. Request bodies, queries and
 * parameters need nothing extra: they are read from the route's `ZodValidationPipe`s.
 */
export const ApiResponse = (schema: z.ZodType | null, options: { status?: number } = {}): MethodDecorator =>
  SetMetadata(API_RESPONSE, { schema, status: options.status } satisfies ApiResponseMeta);

type JsonSchema = Record<string, unknown>;

export interface OpenApiDocument {
  openapi: '3.1.0';
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, JsonSchema>; securitySchemes: Record<string, unknown> };
}

/** A controller as Nest's `DiscoveryService.getControllers()` reports it. */
export interface DiscoveredController {
  instance: object | undefined;
  metatype: unknown;
}

const methods: Partial<Record<RequestMethod, string>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
};

/** Which credentials a route takes, by its prefix (docs/build/00-conventions.md, API routes). */
const security: [prefix: string, scheme: string][] = [
  ['/v1/management/', 'supabaseSession'],
  ['/v1/delivery/', 'deliveryToken'],
  ['/v1/preview/', 'previewToken'],
];

const problemSchema: JsonSchema = {
  type: 'object',
  description: 'RFC 9457 problem details. `code` is stable; `errors` lists field messages by dotted path.',
  properties: {
    type: { type: 'string' },
    title: { type: 'string' },
    status: { type: 'integer' },
    code: { type: 'string' },
    detail: { type: 'string' },
    errors: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
  },
  required: ['type', 'title', 'status', 'code'],
};

/**
 * The OpenAPI 3.1 document for every route of the given controllers, generated from the Zod schemas the
 * routes validate with and the {@link ApiResponse}s they declare.
 */
export function buildOpenApiDocument(controllers: readonly DiscoveredController[], info: OpenApiDocument['info']): OpenApiDocument {
  const doc: OpenApiDocument = {
    openapi: '3.1.0',
    info,
    paths: {},
    components: {
      schemas: { Problem: problemSchema },
      securitySchemes: {
        supabaseSession: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'A Supabase Auth access token (the admin).' },
        deliveryToken: { type: 'http', scheme: 'bearer', description: 'A delivery API token, `nv_del_…`.' },
        previewToken: { type: 'http', scheme: 'bearer', description: 'A preview API token, `nv_pre_…`.' },
      },
    },
  };
  const toSchema = schemaConverter(doc.components.schemas);

  for (const { instance, metatype } of controllers) {
    if (!instance || typeof metatype !== 'function') continue;
    const base = Reflect.getMetadata(PATH_METADATA, metatype) as string | string[] | undefined;
    if (base === undefined) continue;

    for (const name of methodNames(instance)) {
      const handler = (instance as Record<string, unknown>)[name] as object;
      const sub = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
      const verb = methods[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
      if (sub === undefined || !verb) continue;

      const path = joinPath(first(base), first(sub));
      const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, metatype, name) ?? {}) as Record<
        string,
        { index: number; data?: string; pipes?: unknown[] }
      >;
      const parameters: unknown[] = [];
      let requestBody: unknown;

      for (const [key, arg] of Object.entries(args)) {
        const type = Number(key.split(':')[0]);
        const schema = arg.pipes?.find((pipe): pipe is ZodValidationPipe<z.ZodType> => pipe instanceof ZodValidationPipe)?.schema;
        if (type === RouteParamtypes.PARAM && arg.data) {
          parameters.push({ name: arg.data, in: 'path', required: true, schema: schema ? toSchema(schema, 'input') : { type: 'string' } });
        } else if (type === RouteParamtypes.QUERY && schema) {
          parameters.push(...queryParameters(toSchema(schema, 'input')));
        } else if (type === RouteParamtypes.BODY && schema) {
          requestBody = { required: true, content: { 'application/json': { schema: toSchema(schema, 'input') } } };
        }
      }

      const declared = Reflect.getMetadata(API_RESPONSE, handler) as ApiResponseMeta | undefined;
      const status = declared?.status ?? (Reflect.getMetadata(HTTP_CODE_METADATA, handler) as number | undefined) ?? (verb === 'post' ? 201 : 200);
      const scheme = security.find(([prefix]) => path.startsWith(prefix))?.[1];

      doc.paths[path] ??= {};
      doc.paths[path][verb] = {
        operationId: `${(metatype as { name: string }).name}.${name}`,
        tags: [tagOf(path)],
        ...(scheme ? { security: [{ [scheme]: [] }] } : {}),
        ...(parameters.length ? { parameters } : {}),
        ...(requestBody ? { requestBody } : {}),
        responses: {
          [String(status)]:
            declared?.schema && status !== 204
              ? { description: 'OK', content: { 'application/json': { schema: toSchema(declared.schema, 'output') } } }
              : { description: status === 204 ? 'No content' : 'OK' },
          default: {
            description: 'Problem',
            content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
          },
        },
      };
    }
  }
  return doc;
}

/** Own and inherited methods (controllers may share routes through a base class). */
function methodNames(instance: object): string[] {
  const names = new Set<string>();
  for (let proto = Object.getPrototypeOf(instance); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) if (name !== 'constructor') names.add(name);
  }
  return [...names];
}

const first = (path: string | string[]): string => (Array.isArray(path) ? (path[0] ?? '') : path);

function joinPath(base: string, sub: string): string {
  const joined = `/${[base, sub].map((part) => part.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/')}`;
  return joined.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/** `management`, `delivery`, `preview`, `assets`… from `/v1/<area>/…`. */
function tagOf(path: string): string {
  return /^\/v1\/([^/]+)/.exec(path)?.[1] ?? 'other';
}

function queryParameters(schema: JsonSchema): unknown[] {
  const properties = (schema['properties'] ?? {}) as Record<string, JsonSchema>;
  const required = new Set((schema['required'] ?? []) as string[]);
  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: 'query',
    // A query parameter with a default can be left out.
    required: required.has(name) && !('default' in property),
    schema: property,
  }));
}

/**
 * Converts Zod schemas to JSON Schema (2020-12, which OpenAPI 3.1 uses), moving the definitions of
 * recursive schemas into `components.schemas` so their `$ref`s resolve within the document.
 */
function schemaConverter(components: Record<string, JsonSchema>) {
  let counter = 0;
  return (schema: z.ZodType, io: 'input' | 'output'): JsonSchema => {
    let json: JsonSchema;
    try {
      json = z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as JsonSchema;
    } catch {
      return {};
    }
    delete json['$schema'];
    const defs = (json['$defs'] ?? {}) as Record<string, JsonSchema>;
    delete json['$defs'];
    const prefix = `S${++counter}_`;
    const rewrite = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(rewrite);
      if (typeof value !== 'object' || value === null) return value;
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value)) {
        out[key] =
          key === '$ref' && typeof inner === 'string' && inner.startsWith('#/$defs/')
            ? `#/components/schemas/${prefix}${inner.slice('#/$defs/'.length)}`
            : key === '$ref' && inner === '#'
              ? `#/components/schemas/${prefix}root`
              : rewrite(inner);
      }
      return out;
    };
    for (const [name, def] of Object.entries(defs)) components[`${prefix}${name}`] = rewrite(def) as JsonSchema;
    const root = rewrite(json) as JsonSchema;
    // A schema that refers to itself (`#`) needs to be addressable too.
    if (JSON.stringify(root).includes(`${prefix}root"`)) components[`${prefix}root`] = root;
    return root;
  };
}
