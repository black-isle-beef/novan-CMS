import { computed, DOCUMENT, inject, Injectable, signal } from '@angular/core';
import type { Factor, Session } from '@supabase/supabase-js';
import { type AccessTokenClaims, decodeAccessToken } from './access-token';
import { SupabaseClientService } from './supabase-client';

export interface TotpEnrolment {
  factorId: string;
  /** SVG data URI to scan with an authenticator app. */
  qrCode: string;
  /** The same secret as text, for typing in by hand. */
  secret: string;
}

/** Session state and auth actions for the admin, backed by Supabase Auth. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(SupabaseClientService).auth;
  private readonly origin = inject(DOCUMENT).location.origin;

  private readonly sessionState = signal<Session | null>(null);
  private readonly ready: Promise<void>;
  private refreshing: Promise<Session | null> | null = null;

  readonly session = this.sessionState.asReadonly();
  readonly claims = computed<AccessTokenClaims | null>(() => decodeAccessToken(this.session()?.access_token));
  readonly signedIn = computed(() => this.session() !== null);
  readonly email = computed(() => this.session()?.user.email ?? null);
  readonly agencyStaff = computed(() => this.claims()?.agency_staff === true);
  readonly aal = computed(() => this.claims()?.aal ?? 'aal1');
  /** Agency staff must complete a second factor before using the admin (the API enforces it too). */
  readonly needsSecondFactor = computed(() => this.agencyStaff() && this.aal() !== 'aal2');
  /** True after a password-recovery link signed the user in. */
  readonly passwordRecovery = signal(false);

  constructor() {
    // getSession() waits for the client to read tokens from the URL fragment first.
    this.ready = this.auth.getSession().then(({ data }) => this.sessionState.set(data.session));
    this.auth.onAuthStateChange((event, session) => {
      this.sessionState.set(session);
      if (event === 'PASSWORD_RECOVERY') this.passwordRecovery.set(true);
    });
  }

  /** Resolves once the stored (or URL) session has been loaded. */
  whenReady(): Promise<void> {
    return this.ready;
  }

  accessToken(): string | null {
    return this.session()?.access_token ?? null;
  }

  async signInWithPassword(email: string, password: string): Promise<void> {
    const { error } = await this.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  /** Emails a one-time sign-in link. Only existing accounts can use it: invites create accounts. */
  async sendMagicLink(email: string): Promise<void> {
    const { error } = await this.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: `${this.origin}/` },
    });
    if (error) throw error;
  }

  async sendPasswordReset(email: string): Promise<void> {
    const { error } = await this.auth.resetPasswordForEmail(email, { redirectTo: `${this.origin}/update-password` });
    if (error) throw error;
  }

  async updatePassword(password: string): Promise<void> {
    const { error } = await this.auth.updateUser({ password });
    if (error) throw error;
    this.passwordRecovery.set(false);
  }

  /**
   * Gets a fresh access token, e.g. after a 401 or a membership change (claims are minted at
   * refresh). Concurrent callers share one refresh. Resolves null if the session has ended.
   */
  refresh(): Promise<Session | null> {
    this.refreshing ??= this.auth
      .refreshSession()
      .then(({ data, error }) => (error ? null : data.session))
      .finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    this.sessionState.set(null);
  }

  // --- Two-step verification (TOTP) -------------------------------------------

  async verifiedTotpFactors(): Promise<Factor[]> {
    const { data, error } = await this.auth.mfa.listFactors();
    if (error) throw error;
    return data.totp;
  }

  async enrolTotp(): Promise<TotpEnrolment> {
    // Friendly names must be unique per user, including abandoned unverified attempts.
    const { data, error } = await this.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `Authenticator app ${new Date().toISOString()}`,
    });
    if (error) throw error;
    return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
  }

  /** Verifies a code, raising the session to AAL2 (and verifying the factor if newly enrolled). */
  async verifyTotp(factorId: string, code: string): Promise<void> {
    const { error } = await this.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) throw error;
  }
}
