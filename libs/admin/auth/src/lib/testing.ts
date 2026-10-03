import { computed, signal } from '@angular/core';
import type { Session } from '@supabase/supabase-js';
import { decodeAccessToken } from './access-token';
import type { AuthService } from './auth.service';

/** Unsigned JWT with the given claims, for tests (only ever decoded, never verified, in the admin). */
export function fakeAccessToken(claims: Record<string, unknown>): string {
  const encode = (value: object): string => btoa(JSON.stringify(value)).replace(/=+$/, '');
  return `${encode({ alg: 'none' })}.${encode(claims)}.`;
}

export function fakeSession(claims: Record<string, unknown>): Session {
  return {
    access_token: fakeAccessToken(claims),
    refresh_token: 'refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: String(claims['sub']), email: 'user@example.test' },
  } as Session;
}

/** A stand-in for {@link AuthService} driven by a session signal. Spy on its methods as needed. */
export function createFakeAuth(initial: Session | null = null) {
  const session = signal<Session | null>(initial);
  const claims = computed(() => decodeAccessToken(session()?.access_token));
  return {
    session,
    claims,
    signedIn: computed(() => session() !== null),
    email: computed(() => session()?.user.email ?? null),
    agencyStaff: computed(() => claims()?.agency_staff === true),
    aal: computed(() => claims()?.aal ?? 'aal1'),
    needsSecondFactor: computed(() => claims()?.agency_staff === true && claims()?.aal !== 'aal2'),
    passwordRecovery: signal(false),
    whenReady: () => Promise.resolve(),
    accessToken: () => session()?.access_token ?? null,
    signInWithPassword: vi.fn<AuthService['signInWithPassword']>().mockResolvedValue(undefined),
    sendMagicLink: vi.fn<AuthService['sendMagicLink']>().mockResolvedValue(undefined),
    sendPasswordReset: vi.fn<AuthService['sendPasswordReset']>().mockResolvedValue(undefined),
    updatePassword: vi.fn<AuthService['updatePassword']>().mockResolvedValue(undefined),
    refresh: vi.fn<AuthService['refresh']>().mockResolvedValue(null),
    signOut: vi.fn<AuthService['signOut']>().mockImplementation(async () => session.set(null)),
    verifiedTotpFactors: vi.fn<AuthService['verifiedTotpFactors']>().mockResolvedValue([]),
    enrolTotp: vi.fn<AuthService['enrolTotp']>(),
    verifyTotp: vi.fn<AuthService['verifyTotp']>().mockResolvedValue(undefined),
  };
}

export type FakeAuth = ReturnType<typeof createFakeAuth>;
