// Tests the @black-isle-beef/cms-angular/bridge entry point; the unit-test runner only looks under src/.
// The protocol's source of truth, imported only by this test, never by the published build.
import * as shared from '@novan/shared-types';
import * as sdk from '../../bridge/src/protocol';

// The SDK carries its own copy of the bridge protocol. These checks fail when the copy and the workspace's
// version (which the admin uses) stop agreeing, in their types or in what they accept.

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const check = <T extends true>(): T => true as T;

const wrap = (type: string, payload: unknown, extra: object = {}) => ({ source: 'novan', v: 1, type, payload, ...extra });

const samples: unknown[] = [
  null,
  'ready',
  [],
  wrap('ready', { path: '/about', sdkVersion: '0.3.0' }),
  wrap('ready', { path: '/' }),
  wrap('select', { uid: 'a1' }),
  wrap('select', { uid: null }),
  wrap('select', { uid: '' }),
  wrap('hover', { uid: null }),
  wrap('hover', { uid: 'x'.repeat(101) }),
  wrap('rects', { a1: { x: 1, y: 2, width: 3, height: 4 } }),
  wrap('rects', { a1: { x: 1, y: 2, width: Number.POSITIVE_INFINITY, height: 4 } }),
  wrap('update', { data: { title: 'Hi', body: [] } }),
  wrap('update', { data: null }),
  wrap('scrollTo', { uid: 'a1' }),
  wrap('token', { token: 'abc.def' }),
  wrap('token', { token: '' }),
  wrap('insert', { uid: 'a1', position: 'before' }),
  wrap('insert', { uid: 'a1', position: 'inside' }),
  wrap('text', { uid: 'a1', field: 'heading', value: 'Hi', done: true }),
  wrap('text', { uid: 'a1', field: '__proto__.x', value: 'Hi', done: true }),
  wrap('editable', { uid: 'a1', fields: [{ field: 'heading', value: 'Hi', multiline: true }], insert: true }),
  wrap('editable', { uid: 'a1', fields: [] }),
  wrap('editable', { uid: null, fields: [{ field: 'heading', value: 1, multiline: true }] }),
  wrap('headings', { headings: [{ level: 2, text: 'Hi', uid: 'a1' }] }),
  wrap('headings', { headings: [{ level: 2.5, text: 'Hi', uid: 'a1' }] }),
  wrap('reload', {}),
  wrap('select', { uid: 'a1' }, { v: 2 }),
  wrap('select', { uid: 'a1' }, { source: 'someone-else' }),
];

describe('bridge protocol copy', () => {
  it('has the same types as the workspace protocol', () => {
    expect(check<Same<sdk.SiteMessage, shared.SiteMessage>>()).toBe(true);
    expect(check<Same<sdk.AdminMessage, shared.AdminMessage>>()).toBe(true);
    expect(check<Same<sdk.BridgeRect, shared.BridgeRect>>()).toBe(true);
    expect(sdk.BRIDGE_SOURCE).toBe(shared.BRIDGE_SOURCE);
    expect(sdk.BRIDGE_VERSION).toBe(shared.BRIDGE_VERSION);
  });

  it.each(samples.map((sample) => [JSON.stringify(sample)?.slice(0, 80) ?? String(sample), sample]))('reads %s the same way', (_, sample) => {
    expect(sdk.parseSiteMessage(sample)).toEqual(shared.parseSiteMessage(sample));
    expect(sdk.parseAdminMessage(sample)).toEqual(shared.parseAdminMessage(sample));
  });

  it('wraps messages the same way', () => {
    const message = { type: 'hover', payload: { uid: 'a1' } } as const;
    expect(sdk.bridgeEnvelope(message)).toEqual(shared.bridgeEnvelope(message));
  });
});
