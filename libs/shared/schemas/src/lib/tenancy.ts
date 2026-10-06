import { z } from 'zod';

/** Default role keys every space gets (supabase/migrations/0001_tenancy.sql). */
export const spaceRoles = ['admin', 'developer', 'editor', 'author', 'viewer'] as const;
export const spaceRoleSchema = z.enum(spaceRoles);
export type SpaceRole = z.infer<typeof spaceRoleSchema>;

/** One entry of the `spaces` access-token claim. */
export const spaceClaimSchema = z.object({ id: z.uuid(), role: z.string() });
export type SpaceClaim = z.infer<typeof spaceClaimSchema>;

// --- GET /v1/management/me ----------------------------------------------------

export const meResponseSchema = z.object({
  id: z.uuid(),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  agencyStaff: z.boolean(),
  aal: z.enum(['aal1', 'aal2']),
  spaces: z.array(spaceClaimSchema),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

// --- spaces -------------------------------------------------------------------

export const spaceSlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens.');

export const createSpaceRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: spaceSlugSchema,
  /** Defaults to the only organisation the caller can see. */
  organisationId: z.uuid().optional(),
});
export type CreateSpaceRequest = z.infer<typeof createSpaceRequestSchema>;

export const spaceSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  organisationId: z.uuid(),
  /** Origin of the space's site, e.g. `https://www.example.com`, used to open pages from the admin. */
  previewUrl: z.string().nullable(),
  /** The caller's role, or null when they see the space as agency staff without being a member. */
  role: spaceRoleSchema.nullable(),
  createdAt: z.string(),
});
export type SpaceSummary = z.infer<typeof spaceSummarySchema>;

/** PATCH `/spaces/:spaceId` (space admins and agency staff): what the Space settings screen changes. */
export const updateSpaceRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    /** The site's origin, e.g. `https://www.example.com`, or null to forget it. */
    previewUrl: z
      .url({ protocol: /^https?$/, error: 'Enter a web address starting with https:// or http://.' })
      .max(2048)
      .transform((url) => url.replace(/\/+$/, ''))
      .nullable()
      .optional(),
  })
  .refine((body) => body.name !== undefined || body.previewUrl !== undefined, 'Change the name or the site address.');
export type UpdateSpaceRequest = z.input<typeof updateSpaceRequestSchema>;

// --- onboarding checklist (supabase/migrations/0009_onboarding.sql) -------------

/** Steps in the order the dashboard lists them. */
export const onboardingSteps = ['logo', 'homePage', 'newPage', 'publish'] as const;
export const onboardingStepSchema = z.enum(onboardingSteps);
export type OnboardingStep = z.infer<typeof onboardingStepSchema>;

/** `spaces.settings.onboarding`: when each step was first done, and when the checklist was dismissed. */
export const onboardingSchema = z.object({
  completed: z.partialRecord(onboardingStepSchema, z.string()),
  dismissedAt: z.string().nullable(),
});
export type Onboarding = z.infer<typeof onboardingSchema>;

/** GET `/spaces/:spaceId/onboarding`. `checklist` is null for spaces created before the checklist existed. */
export const onboardingResponseSchema = z.object({ checklist: onboardingSchema.nullable() });
export type OnboardingResponse = z.infer<typeof onboardingResponseSchema>;

// --- view as (agency staff) ----------------------------------------------------

/** POST `/spaces/:spaceId/view-as`: agency staff start (`role`) or stop (`null`) viewing a space as a role. Audited only. */
export const viewAsRequestSchema = z.object({ role: spaceRoleSchema.nullable() });
export type ViewAsRequest = z.infer<typeof viewAsRequestSchema>;

// --- members and invites ------------------------------------------------------

export const memberSchema = z.object({
  userId: z.uuid(),
  displayName: z.string().nullable(),
  role: spaceRoleSchema,
  invitedBy: z.uuid().nullable(),
  createdAt: z.string(),
});
export type Member = z.infer<typeof memberSchema>;

export const addMemberRequestSchema = z.object({ userId: z.uuid(), role: spaceRoleSchema });
export type AddMemberRequest = z.infer<typeof addMemberRequestSchema>;

export const updateMemberRequestSchema = z.object({ role: spaceRoleSchema });
export type UpdateMemberRequest = z.infer<typeof updateMemberRequestSchema>;

export const inviteRequestSchema = z.object({
  email: z.email().trim().toLowerCase(),
  role: spaceRoleSchema,
});
export type InviteRequest = z.infer<typeof inviteRequestSchema>;
