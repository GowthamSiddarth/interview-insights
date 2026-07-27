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
