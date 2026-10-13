import { GoTrueClient, type Session } from '@supabase/auth-js';
import { createInterface } from 'node:readline/promises';
import type { NovanApi } from './api';
import { type Profile, readProfile } from './config';
import { CliError } from './errors';

/** Where refresh tokens are kept: the OS keychain, or a stand-in in tests. One per API address. */
export interface SecretStore {
  get(account: string): Promise<string | null>;
  set(account: string, secret: string): Promise<void>;
  delete(account: string): Promise<void>;
}

const SERVICE = 'novan-cli';

/** The OS keychain (Windows Credential Manager, macOS Keychain, Secret Service on Linux). */
export function keychain(): SecretStore {
  const entry = async (account: string) => {
    try {
      const { Entry } = await import('@napi-rs/keyring');
      return new Entry(SERVICE, account);
    } catch (error) {
      throw new CliError(
        `The OS keychain is not available here (${(error as Error).message}). ` +
          'Sign in with NOVAN_EMAIL and NOVAN_PASSWORD, or NOVAN_ACCESS_TOKEN, instead.',
      );
    }
  };
  return {
    get: async (account) => (await entry(account)).getPassword() ?? null,
    set: async (account, secret) => (await entry(account)).setPassword(secret),
    delete: async (account) => {
      (await entry(account)).deletePassword();
    },
  };
}

export function authClient(supabaseUrl: string, anonKey: string): GoTrueClient {
  return new GoTrueClient({
    url: `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`,
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  });
}

/** Asks for the six-digit code when the person's account needs a second factor (agency staff), and verifies it. */
export async function completeSecondFactor(auth: GoTrueClient, prompt: (question: string) => Promise<string> = ask): Promise<Session> {
  const { data: level, error } = await auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw new CliError(`Could not check two-step verification: ${error.message}`);
  if (level.nextLevel === 'aal2' && level.currentLevel !== 'aal2') {
    const { data: factors, error: listError } = await auth.mfa.listFactors();
    const factor = factors?.totp.find((candidate) => candidate.status === 'verified');
    if (listError || !factor) throw new CliError('Your account needs two-step verification, but no authenticator app is set up.');
    for (let attempt = 1; ; attempt++) {
      const code = (await prompt('Code from your authenticator app: ')).replace(/\s/g, '');
      const { error: verifyError } = await auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      if (!verifyError) break;
      if (attempt >= 3) throw new CliError(`Two-step verification failed: ${verifyError.message}`);
      console.error('That code did not work. Try the next one.');
    }
  }
  const { data } = await auth.getSession();
  if (!data.session) throw new CliError('Signing in did not give a session. Run novan login again.');
  return data.session;
}

async function ask(question: string): Promise<string> {
  if (!process.stdin.isTTY) throw new CliError('Two-step verification needs a terminal to type the code into.');
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/**
 * An access token for the API, from (in order): `NOVAN_ACCESS_TOKEN`; `NOVAN_EMAIL` and `NOVAN_PASSWORD` (CI, with
 * an account that needs no second factor); or the refresh token `novan login` keeps in the OS keychain. Supabase
 * rotates refresh tokens, so the new one is stored straight away.
 */
export class Credentials {
  private cached?: { token: string; expiresAt: number };

  constructor(
    private readonly api: () => NovanApi,
    private readonly secrets: SecretStore = keychain(),
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async accessToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt - 60_000 > Date.now()) return this.cached.token;
    const session = await this.freshSession();
    this.cached = { token: session.access_token, expiresAt: (session.expires_at ?? 0) * 1000 || Date.now() + 300_000 };
    return session.access_token;
  }

  /** Forget the cached token, e.g. after creating a space so the new membership reaches the token's claims. */
  async refreshNow(): Promise<void> {
    this.cached = undefined;
    await this.accessToken();
  }

  private async freshSession(): Promise<Pick<Session, 'access_token' | 'expires_at'>> {
    const token = this.env['NOVAN_ACCESS_TOKEN'];
    if (token) return { access_token: token, expires_at: undefined };

    const email = this.env['NOVAN_EMAIL'];
    const password = this.env['NOVAN_PASSWORD'];
    if (email && password) {
      const settings = await this.api().authSettings();
      const auth = authClient(settings.supabaseUrl, settings.supabaseAnonKey);
      const { data, error } = await auth.signInWithPassword({ email, password });
      if (error || !data.session) throw new CliError(`Signing in as ${email} failed: ${error?.message ?? 'no session'}.`);
      const { data: level } = await auth.mfa.getAuthenticatorAssuranceLevel();
      if (level?.nextLevel === 'aal2' && level.currentLevel !== 'aal2') {
        throw new CliError(`${email} needs two-step verification, so it cannot sign in unattended. Use an account without it for CI.`);
      }
      return data.session;
    }

    const profile = readProfile(this.env);
    const apiUrl = this.api().apiUrl;
    if (!profile?.apiUrl || profile.apiUrl !== apiUrl) {
      throw new CliError(`You are not signed in to ${apiUrl}. Run novan login --api ${apiUrl}.`);
    }
    const refreshToken = await this.secrets.get(apiUrl);
    if (!refreshToken) throw new CliError(`You are not signed in to ${apiUrl}. Run novan login.`);
    return this.refresh(profile, refreshToken);
  }

  private async refresh(profile: Profile, refreshToken: string): Promise<Session> {
    const { data, error } = await authClient(profile.supabaseUrl, profile.supabaseAnonKey).refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) {
      throw new CliError(`Your sign-in to ${profile.apiUrl} has ended (${error?.message ?? 'no session'}). Run novan login again.`);
    }
    await this.secrets.set(profile.apiUrl, data.session.refresh_token);
    return data.session;
  }
}
