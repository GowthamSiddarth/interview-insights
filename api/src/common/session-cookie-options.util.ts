export interface SessionCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
}

// Shared by every httpOnly-cookie session in this app (admin-auth,
// candidate-auth) — extracted (GitHub issue #145's brainstorm) so a
// second module can't silently drift from the Secure-cookie-over-HTTP
// fix admin-auth needed (see admin-auth.controller.ts's own history):
// `secure` must come from an explicit COOKIE_SECURE env var, never
// inferred from NODE_ENV, which is 'production' in every deployed
// container regardless of whether it's actually served over HTTPS.
// Every environment this project runs in today (local kind) is plain
// HTTP with no TLS termination — flip COOKIE_SECURE=true only once a
// real TLS-terminated environment exists (Phase 8/staging).
export function getSessionCookieOptions(): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: 'lax',
  };
}
