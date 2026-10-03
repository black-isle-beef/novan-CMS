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
  /** The caller's role, or null when they see the space as agency staff without being a member. */
  role: spaceRoleSchema.nullable(),
  createdAt: z.string(),
});
export type SpaceSummary = z.infer<typeof spaceSummarySchema>;

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
