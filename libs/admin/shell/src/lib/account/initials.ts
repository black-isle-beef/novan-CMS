/**
 * Up to two initials for the account button, from the part of an email address before the `@`: one per word
 * (`sam.lee@…` is SL), or its first two letters when it is one word. Profiles have no display name yet.
 */
export function initialsFromEmail(email: string | null): string {
  const local = (email ?? '').split('@')[0];
  const words = local.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '').slice(0, 2);
  return letters.toLocaleUpperCase('en-GB') || '?';
}
