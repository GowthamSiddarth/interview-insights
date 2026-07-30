// GitHub issue #163 (Phase 19) — ANTHROPIC_API_KEY is provisioned
// imperatively, the same way ADMIN_PASSWORD_HASH/ADMIN_JWT_SECRET and
// LOCALSTACK_AUTH_TOKEN are (see admin-auth.env.ts, D23) — never committed
// to a manifest or checked into .env.example with a working value. Unlike
// those two, this feature is advisory and entirely optional: an unset key
// simply turns the feature off (isAiModerationEnabled() false), rather
// than the app failing to boot. ANTHROPIC_MODEL is not a secret and has no
// hardcoded fallback — it must be set explicitly whenever the key is, so
// the model in use is always a deliberate choice, never an assumed default.

export function isAiModerationEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Only ever called when isAiModerationEnabled() is true — same lazy,
// throw-on-use pattern as candidates.service.ts's getEmailHashSecret() and
// admin-auth.env.ts's getRequiredAdminEnv().
export function getAnthropicModel(): string {
  const model = process.env.ANTHROPIC_MODEL;
  if (!model) {
    throw new Error('ANTHROPIC_MODEL must be set when ANTHROPIC_API_KEY is configured.');
  }
  return model;
}

// Single hard confidence cutoff for auto-approval routing (D71, GitHub
// issue #439/#437) — no numeric default is committed in the design; it's
// meant to be tuned empirically once real verdict/confidence data exists
// in an environment, not guessed here. Unlike ANTHROPIC_MODEL, leaving this
// unset doesn't throw: it just means nothing is ever eligible for
// auto-approval, i.e. today's D66 advisory-only behavior. Only a *set but
// invalid* value (unparseable, or outside [0, 1]) is treated as a
// misconfiguration worth failing loudly for.
export function getAutoApprovalConfidenceThreshold(): number | null {
  const raw = process.env.AI_MODERATION_AUTO_APPROVE_THRESHOLD;
  // GitHub issue #450 — an explicitly empty string (as opposed to a truly
  // unset var) must also mean "unset": this project's own convention
  // (.env.example, docker-compose.yml) uses "" for every disabled optional
  // var, including this one's sibling ANTHROPIC_API_KEY. Without this
  // check, Number('') is 0 (not NaN), so an operator following that exact
  // convention here would silently get threshold=0 — every clean verdict
  // eligible regardless of confidence, the opposite of fail-closed.
  if (raw === undefined || raw === '') return null;

  const threshold = Number(raw);
  if (Number.isNaN(threshold) || threshold < 0 || threshold > 1) {
    throw new Error(
      `AI_MODERATION_AUTO_APPROVE_THRESHOLD must be a number between 0 and 1, got "${raw}".`,
    );
  }
  return threshold;
}

// GitHub issue #441 (Phase 39, D71) — single global kill switch for the
// auto-approval decision, deliberately separate from
// getAutoApprovalConfidenceThreshold() above: an operator flipping this off
// doesn't lose whatever threshold they've already tuned, and flipping it
// back on doesn't require re-entering it. Same fail-closed default as the
// threshold (unset means disabled, not an error) and the same
// COOKIE_SECURE-style `=== 'true'` boolean-env convention already used
// elsewhere in this project (see session-cookie-options.util.ts) — no
// deploy needed to flip it, just an env change.
export function isAutoApprovalEnabled(): boolean {
  return process.env.AI_AUTO_APPROVAL_ENABLED === 'true';
}
