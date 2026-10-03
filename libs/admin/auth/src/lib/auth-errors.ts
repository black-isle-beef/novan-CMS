const messages: Record<string, string> = {
  invalid_credentials: 'Your email or password is incorrect.',
  email_not_confirmed: 'Confirm your email address first, using the link we sent you.',
  otp_expired: 'That link has expired. Request a new one.',
  over_email_send_rate_limit: 'Too many emails sent. Wait a few minutes and try again.',
  over_request_rate_limit: 'Too many attempts. Wait a few minutes and try again.',
  mfa_verification_failed: 'That code did not work. Check your authenticator app and try again.',
  mfa_challenge_expired: 'That code has expired. Enter the current one from your app.',
  session_not_found: 'Your sign-in has ended, perhaps because you signed in somewhere else. Sign in again.',
  session_expired: 'Your sign-in has ended. Sign in again.',
  weak_password: 'Choose a longer password, with letters and numbers.',
  same_password: 'Choose a password you have not used here before.',
  user_not_found: 'We could not find an account with that email address.',
  otp_disabled: 'We could not find an account with that email address.',
};

/** Plain-language message for a Supabase Auth error. */
export function authErrorMessage(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'string' && messages[code]) return messages[code];
  return 'Something went wrong. Please try again.';
}
