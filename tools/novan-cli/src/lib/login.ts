import { spawn } from 'node:child_process';
import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import type { NovanApi } from './api';
import { writeProfile } from './config';
import { ApiError, CliError } from './errors';
import { authClient, completeSecondFactor, type SecretStore } from './session';

export interface LoginOptions {
  /** Open the approval page in the default browser. */
  browser: boolean;
  log: (line: string) => void;
  /** Tests make waiting instant. */
  wait?: (ms: number) => Promise<unknown>;
  prompt?: (question: string) => Promise<string>;
}

/**
 * Device sign-in (RFC 8628): show a code, have the person approve it in the admin, then swap the approval for a
 * session of the CLI's own. Staff confirm with their authenticator app here too. The refresh token goes to the OS
 * keychain; the profile (API, Supabase address, email) to the config directory.
 */
export async function login(api: NovanApi, secrets: SecretStore, options: LoginOptions): Promise<string> {
  const wait = options.wait ?? sleep;
  const started = await api.startDeviceAuthorization(`Novan CLI on ${hostname()}`.slice(0, 100));
  options.log(`To sign in, open ${started.verificationUri}`);
  options.log(`and check it shows this code: ${started.userCode}`);
  options.log('');
  if (options.browser) openBrowser(started.verificationUriComplete);

  const deadline = Date.now() + started.expiresIn * 1000;
  let interval = started.interval;
  for (;;) {
    await wait(interval * 1000);
    if (Date.now() > deadline) throw new CliError('The code expired before it was approved. Run novan login again.');
    try {
      const token = await api.deviceToken(started.deviceCode);
      const auth = authClient(token.supabaseUrl, token.supabaseAnonKey);
      const { error } = await auth.verifyOtp({ token_hash: token.tokenHash, type: 'magiclink' });
      if (error) throw new CliError(`Signing in failed: ${error.message}. Run novan login again.`);
      const session = await completeSecondFactor(auth, options.prompt);
      await secrets.set(api.apiUrl, session.refresh_token);
      writeProfile({ apiUrl: api.apiUrl, supabaseUrl: token.supabaseUrl, supabaseAnonKey: token.supabaseAnonKey, email: token.email });
      return token.email;
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.code === 'authorization_pending') continue;
      if (error.code === 'slow_down') {
        interval += 5;
        continue;
      }
      if (error.code === 'access_denied') throw new CliError('The sign-in was denied in the admin.');
      if (error.code === 'expired_token') throw new CliError('The code expired or was already used. Run novan login again.');
      throw error;
    }
  }
}

/** Best effort: if no browser opens, the person follows the printed address. */
function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
  } catch {
    // Printed above.
  }
}
