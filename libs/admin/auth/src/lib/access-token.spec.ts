import { decodeAccessToken } from './access-token';
import { fakeAccessToken } from './testing';

describe('decodeAccessToken', () => {
  it('reads the custom claims', () => {
    const token = fakeAccessToken({
      sub: 'user-1',
      aal: 'aal2',
      agency_staff: true,
      spaces: [{ id: 'space-1', role: 'admin' }],
    });

    expect(decodeAccessToken(token)).toEqual({
      sub: 'user-1',
      aal: 'aal2',
      agency_staff: true,
      spaces: [{ id: 'space-1', role: 'admin' }],
    });
  });

  it('decodes non-ASCII text', () => {
    const payload = btoa(
      String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ sub: 'u', email: 'zoë@example.test' }))),
    );

    expect(decodeAccessToken(`x.${payload.replace(/=+$/, '')}.y`)?.email).toBe('zoë@example.test');
  });

  it.each([null, undefined, '', 'not-a-jwt', 'a.!!!.c', fakeAccessToken({ no: 'sub' })])(
    'returns null for %s',
    (token) => {
      expect(decodeAccessToken(token)).toBeNull();
    },
  );
});
