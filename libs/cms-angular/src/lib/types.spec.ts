// A type-only import in a test, never part of the published build.
// eslint-disable-next-line @nx/enforce-module-boundaries
import type { BlockNode, DeliveryAsset, DeliveryEntriesPage, DeliveryEntry, ProseMirrorNode as SchemaNode } from '@novan/shared-schemas';
import type { NovanAsset, NovanBlockNode, NovanEntry, Paged, ProseMirrorNode } from './types';

// The SDK is published on its own, so it copies the delivered shapes instead of importing
// @novan/shared-schemas. These assignments stop the copies drifting: they fail to compile if the API's
// shapes change in a way the SDK's types do not match.

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const check = <T extends true>(): T => true as T;

describe('SDK types', () => {
  it('match what the Delivery API sends', () => {
    expect(check<Same<NovanEntry, DeliveryEntry>>()).toBe(true);
    expect(check<Same<Paged, DeliveryEntriesPage>>()).toBe(true);
    expect(check<Same<NovanAsset, DeliveryAsset>>()).toBe(true);
    expect(check<Same<NovanBlockNode, BlockNode>>()).toBe(true);
    expect(check<Same<ProseMirrorNode, SchemaNode>>()).toBe(true);
  });
});
