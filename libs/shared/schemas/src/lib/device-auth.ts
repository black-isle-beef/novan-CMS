import { z } from 'zod';

// Device sign-in for the Novan CLI (docs/build/19-schema-cli-starter-kits.md), after RFC 8628:
//   POST /v1/auth/device-authorizations           the CLI asks for a code pair
//   POST /v1/auth/device-authorizations/token     the CLI polls until the person decides
//   GET  /v1/auth/device-authorizations/settings  Supabase's public address and anon key (CI signs in with a password)
//   POST /v1/management/device-authorizations/decide   the person approves or denies in the admin

/** Consonants only, so a code never spells a word: 20^8 codes. */
export const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';

/** How long a code pair lives, and how often the CLI may poll. */
export const DEVICE_CODE_TTL_SECONDS = 600;
export const DEVICE_POLL_INTERVAL_SECONDS = 5;

/** `bcdf ghjk`, `BCDF-GHJK` and `bcdfghjk` all give `BCDFGHJK`. */
export function normaliseUserCode(code: string): string {
  return code.replace(/[^A-Za-z]/g, '').toUpperCase();
}

/** `BCDFGHJK` is shown as `BCDF-GHJK`. */
export function formatUserCode(code: string): string {
  const plain = normaliseUserCode(code);
  return `${plain.slice(0, 4)}-${plain.slice(4)}`;
}

export const userCodeSchema = z
  .string()
  .trim()
  .max(20)
  .transform(normaliseUserCode)
  .pipe(z.string().regex(new RegExp(`^[${USER_CODE_ALPHABET}]{8}$`), 'Enter the eight letters the CLI shows, like BCDF-GHJK.'));

export const startDeviceAuthorizationRequestSchema = z.strictObject({
  /** Shown on the approval page, e.g. "Novan CLI on build-laptop". */
  clientName: z.string().trim().min(1).max(100),
});
export type StartDeviceAuthorizationRequest = z.input<typeof startDeviceAuthorizationRequestSchema>;

export interface DeviceAuthorization {
  /** Secret: only the CLI that asked holds it. */
  deviceCode: string;
  /** What the person types at `verificationUri`, as `BCDF-GHJK`. */
  userCode: string;
  verificationUri: string;
  /** `verificationUri` with the code filled in. */
  verificationUriComplete: string;
  expiresIn: number;
  /** Seconds to wait between polls. */
  interval: number;
}

export const deviceTokenRequestSchema = z.strictObject({
  deviceCode: z.string().trim().regex(/^[A-Za-z0-9_-]{43}$/, 'Send the deviceCode the API gave you.'),
});
export type DeviceTokenRequest = z.input<typeof deviceTokenRequestSchema>;

/**
 * An approved code, swapped once for a sign-in: the CLI exchanges `tokenHash` with Supabase Auth
 * (`verifyOtp({ token_hash, type: 'magiclink' })`) for a session of its own. Supabase's URL and public anon key come
 * with it, so `novan login` needs only the API's address.
 */
export interface DeviceToken extends DeviceAuthSettings {
  tokenHash: string;
  email: string;
}

/** `GET /v1/auth/device-authorizations/settings`: Supabase's public address and anon key. */
export interface DeviceAuthSettings {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

/** Problem codes the token route answers 400 with while there is no sign-in to give (RFC 8628 section 3.5). */
export const deviceTokenPendingCodes = ['authorization_pending', 'slow_down', 'expired_token', 'access_denied'] as const;
export type DeviceTokenPendingCode = (typeof deviceTokenPendingCodes)[number];

export const decideDeviceAuthorizationRequestSchema = z.strictObject({
  userCode: userCodeSchema,
  approve: z.boolean(),
});
export type DecideDeviceAuthorizationRequest = z.input<typeof decideDeviceAuthorizationRequestSchema>;

export interface DeviceAuthorizationDecision {
  status: 'approved' | 'denied';
}
