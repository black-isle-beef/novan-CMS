import { sql } from 'drizzle-orm';
import type { DbTransaction } from './db.service';

/** Steps of a space's onboarding checklist (0009_onboarding.sql, `onboardingSteps` in shared-schemas). */
export type OnboardingStepKey = 'logo' | 'homePage' | 'newPage' | 'publish';

/**
 * Records the first time a checklist step was done, inside a {@link DbService.userDb} transaction so it
 * commits with the change that completed it. The function checks the caller's role from the same claims as
 * RLS, and does nothing for a step already done or a space without a checklist.
 */
export async function completeOnboardingStep(tx: DbTransaction, spaceId: string, step: OnboardingStepKey): Promise<void> {
  await tx.execute(sql`select public.complete_onboarding_step(${spaceId}::uuid, ${step})`);
}

/** Hides the space's checklist for everyone in it (authors and up, agency staff). */
export async function dismissOnboarding(tx: DbTransaction, spaceId: string): Promise<void> {
  await tx.execute(sql`select public.dismiss_onboarding(${spaceId}::uuid)`);
}
