# Phase 57, Issue #827 — AI-Triage Transient Failures Indistinguishable From "Not Configured"

*Part of Phase 57 — Code Quality & Performance Hardening.
See `docs/ROADMAP.md` Phase 57, Phase 57's own #821.*

## The gap

`AnalysisService.computeVerdict()`'s single `catch` block logged every
failure mode identically — a missing `ANTHROPIC_API_KEY`, the entity
having been deleted mid-flight, a malformed LLM response, and a
transient Anthropic API outage (a rate limit, a timeout, a 5xx) all
produced the same generic error log. Nothing was actually *lost* —
every submission is human-reviewed regardless (CLAUDE.md hard
constraint #2), and `ReconciliationSweepService`'s 24-hour sweep
eventually escalates a still-verdict-less row to a human flag either
way — but a routine transient API hiccup now took up to 24 hours to
even reach a human's radar instead of seconds, and a traffic-spike-driven
burst of 429s would look, in the logs, identical to "the AI-triage
feature silently switched off."

## The fix: distinguish, don't retry — the SDK already retries

The Anthropic SDK's own client already retries retryable errors
(`RateLimitError`, `InternalServerError`, connection errors) internally
before ever throwing — by the time an error reaches this service's
`catch`, a transient blip has already had a shot at self-healing. Adding
a second, custom retry loop on top would be redundant. What was
actually missing was *distinguishability* in the log:

```ts
// GitHub issue #827 (Phase 57) — 5xx, 429, and connection/timeout errors are
// the same class the Anthropic SDK itself already retries before giving up
// — everything else (auth, bad request, parse failure, missing entity) is
// terminal and won't resolve on its own.
function isRetryableApiError(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (err instanceof Anthropic.APIError) {
    return err.status === 429 || (typeof err.status === 'number' && err.status >= 500);
  }
  return false;
}
```

```ts
catch (err: unknown) {
  const stack = err instanceof Error ? err.stack : err;
  if (isRetryableApiError(err)) {
    this.logger.warn(
      `AI moderation triage hit a retryable API error for ${entityType} ${entityId} (already retried internally by the SDK) — likely transient; ReconciliationSweepService's 24h sweep will re-triage if it doesn't recover on its own`,
      stack,
    );
  } else {
    this.logger.error(`AI moderation triage failed for ${entityType} ${entityId}`, stack);
  }
  return null;
}
```

Same return value (`null`) either way — nothing about the actual
behavior changes, since every failure mode already degrades identically
(no verdict, human review proceeds regardless). The fix is purely
observability: an operator scanning logs can now immediately tell "the
SDK's retries were exhausted, this may self-heal" apart from a genuine
configuration or data problem, without waiting 24 hours for the
reconciliation sweep to say more.

## Verification

Parameterized unit tests cover a 429 (`RateLimitError`), a 500
(`InternalServerError`), and a connection error, each asserting a
`warn`-level log and confirming `error` was never called — plus a
terminal case (a 400 `BadRequestError`) asserting the reverse. All four
still return `null`, confirming the distinction is purely in how it's
logged, not in what happens next.
