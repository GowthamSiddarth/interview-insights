import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// For issue #146 (sessions on the write path) to apply to write-path
// controllers — 401s on a missing/invalid/expired candidate_session
// cookie via AuthGuard's default handleRequest, same as AdminJwtAuthGuard.
@Injectable()
export class CandidateJwtAuthGuard extends AuthGuard('candidate-jwt') {}
