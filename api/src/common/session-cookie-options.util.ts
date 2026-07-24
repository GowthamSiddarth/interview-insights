export interface SessionCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  domain?: string;
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
//
// `domain` defaults to unset (host-only cookie) — correct for local dev,
// where `web`/`api` both run on `localhost` and browsers scope cookies by
// host, ignoring port. But `web`/`api` are served from genuinely different
// hostnames in every deployed environment (`app.` vs `api.
// interview-insights.local`), so a host-only cookie set by `api`'s
// response is invisible to `web`'s own JS (`document.cookie`) — this is
// exactly what broke the non-httpOnly session-hint cookie's NavBar check
// (D32) the moment anyone used the real Ingress-fronted app instead of
// local dev servers. COOKIE_DOMAIN widens the cookie to the shared parent
// domain (e.g. `.interview-insights.local`) so both subdomains can see it.
export function getSessionCookieOptions(): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: 'lax',
    domain: process.env.COOKIE_DOMAIN || undefined,
  };
}
