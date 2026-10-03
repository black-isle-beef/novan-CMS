import { Module } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { JWT_VERIFIER_CONFIG, JwtVerifier, jwtVerifierConfigFromEnv } from './jwt-verifier';
import { SpaceGuard } from './space.guard';
import { SupabaseAdmin } from './supabase-admin';

@Module({
  providers: [
    { provide: JWT_VERIFIER_CONFIG, useFactory: () => jwtVerifierConfigFromEnv() },
    JwtVerifier,
    AuthGuard,
    SpaceGuard,
    SupabaseAdmin,
  ],
  exports: [JWT_VERIFIER_CONFIG, JwtVerifier, AuthGuard, SpaceGuard, SupabaseAdmin],
})
export class AuthModule {}
