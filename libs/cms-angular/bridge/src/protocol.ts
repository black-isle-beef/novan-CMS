// The visual editor's bridge protocol, as the site speaks it. The SDK is published on its own, so this is a copy
// of `libs/shared/types/src/lib/bridge.ts` in the Novan CMS repository; `src/bridge/protocol.spec.ts` fails if the
// two drift apart. Change both together.

/** Every message carries these, so other `postMessage` traffic is ignored. */
export const BRIDGE_SOURCE = 'novan';
export const BRIDGE_VERSION = 1;

/** A block's box in the iframe's viewport, in CSS pixels. */
export interface BridgeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the site sends the admin. */
export type SiteMessage =
  /** The bridge started, or the page in the iframe changed. */
  | { type: 'ready'; payload: { path: string; sdkVersion: string } }
  /** The editor clicked a block. */
  | { type: 'select'; payload: { uid: string } }
  /** The pointer moved onto a block, or off every block (`null`). */
  | { type: 'hover'; payload: { uid: string | null } }
  /** Where each block is, after a render, scroll or resize. */
  | { type: 'rects'; payload: Record<string, BridgeRect> };

/** What the admin sends the site. */
export type AdminMessage =
  /** The page's data, in the shape the Preview API delivers it; replaces what the site shows. */
  | { type: 'update'; payload: { data: Record<string, unknown> } }
  | { type: 'select'; payload: { uid: string | null } }
  | { type: 'hover'; payload: { uid: string | null } }
  | { type: 'scrollTo'; payload: { uid: string } }
  /** A fresh signed preview token, before the one the page was opened with expires. */
  | { type: 'token'; payload: { token: string } };

export type BridgeEnvelope<M> = M & { source: typeof BRIDGE_SOURCE; v: typeof BRIDGE_VERSION };

/** Wraps a message for `postMessage`. */
export function bridgeEnvelope<M extends SiteMessage | AdminMessage>(message: M): BridgeEnvelope<M> {
  return { source: BRIDGE_SOURCE, v: BRIDGE_VERSION, ...message };
}

const MAX_UID = 100;
const MAX_PATH = 1000;
const MAX_TOKEN = 4096;
const MAX_RECTS = 5000;

/** A message from the site, or null when `data` is not one (wrong source or version, unknown type, bad payload). */
export function parseSiteMessage(data: unknown): SiteMessage | null {
  const envelope = readEnvelope(data);
  if (!envelope) return null;
  const { type, payload } = envelope;
  switch (type) {
    case 'ready':
      return isObject(payload) && isString(payload['path'], MAX_PATH) && isString(payload['sdkVersion'], 100)
        ? { type, payload: { path: payload['path'], sdkVersion: payload['sdkVersion'] } }
        : null;
    case 'select':
      return isObject(payload) && isUid(payload['uid']) ? { type, payload: { uid: payload['uid'] } } : null;
    case 'hover':
      return isObject(payload) && isUidOrNull(payload['uid']) ? { type, payload: { uid: payload['uid'] } } : null;
    case 'rects': {
      if (!isObject(payload)) return null;
      const entries = Object.entries(payload);
      if (entries.length > MAX_RECTS) return null;
      const rects: Record<string, BridgeRect> = {};
      for (const [uid, rect] of entries) {
        if (!isUid(uid) || !isRect(rect)) return null;
        rects[uid] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
      return { type, payload: rects };
    }
    default:
      return null;
  }
}

/** A message from the admin, or null when `data` is not one. */
export function parseAdminMessage(data: unknown): AdminMessage | null {
  const envelope = readEnvelope(data);
  if (!envelope) return null;
  const { type, payload } = envelope;
  switch (type) {
    case 'update':
      return isObject(payload) && isObject(payload['data']) ? { type, payload: { data: payload['data'] } } : null;
    case 'select':
    case 'hover':
      return isObject(payload) && isUidOrNull(payload['uid']) ? { type, payload: { uid: payload['uid'] } } : null;
    case 'scrollTo':
      return isObject(payload) && isUid(payload['uid']) ? { type, payload: { uid: payload['uid'] } } : null;
    case 'token':
      return isObject(payload) && isString(payload['token'], MAX_TOKEN) && payload['token'] !== ''
        ? { type, payload: { token: payload['token'] } }
        : null;
    default:
      return null;
  }
}

function readEnvelope(data: unknown): { type: unknown; payload: unknown } | null {
  if (!isObject(data) || data['source'] !== BRIDGE_SOURCE || data['v'] !== BRIDGE_VERSION) return null;
  return { type: data['type'], payload: data['payload'] };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

function isUid(value: unknown): value is string {
  return isString(value, MAX_UID) && value !== '';
}

function isUidOrNull(value: unknown): value is string | null {
  return value === null || isUid(value);
}

function isRect(value: unknown): value is BridgeRect {
  return isObject(value) && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(value[key]));
}
