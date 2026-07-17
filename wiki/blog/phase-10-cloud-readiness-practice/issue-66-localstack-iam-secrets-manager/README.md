# Phase 10, Issue #66 — LocalStack IAM Policy Validation & Secrets Manager Integration

*Part of Phase 10 — Cloud-Readiness Practice (Local, Free). See
`docs/ROADMAP.md` Phase 10, `docs/DECISIONS.md` D20.*

Deep-dive by request. This issue is unusual among this project's history
in how much of its real content is *things that didn't work as expected*
— and each one is a genuinely transferable lesson about the gap between
"an AWS emulator" as a marketing category and what a specific tool's free
tier actually, concretely does.

## Why this came first

Phase 8 (production hardening) is entirely trigger-gated — nothing in it
should be built until a real need forces it, per the discipline
established across this project (D9, and Phase 8's own planning
convention). But two of its sub-areas, 8b (secrets management) and 8d
(IAM), have integration *code* that's genuinely useful to write and
prove correct well before either trigger fires — the same way you'd
write and unit-test a function before wiring it into production traffic.
This issue is where that code gets written, validated against a real
(if emulated) AWS API, and deliberately left disconnected from anything
that actually runs.

## Core concept: what "$0 AWS emulation" actually promises, and where the promise runs out

The premise going into this issue was reasonable on its face: LocalStack
markets itself as letting you develop against AWS APIs without an AWS
account. The real, useful question this issue answers is *which* APIs,
and *how completely*, for a project that hasn't paid anything. Two
distinct findings, confirmed directly rather than assumed from marketing
copy, define the actual boundary:

**Finding 1 — even starting the container now requires an account.**
LocalStack's own 2026 packaging announcement states it plainly: "we will
only support one single image for LocalStack for AWS via Docker Hub,
which will require a user account and an auth token to run." This
applies *before* any service-tier question — you cannot start the
`latest` LocalStack image today, for any reason, without first creating
a free account and obtaining `LOCALSTACK_AUTH_TOKEN`. This is worth
internalizing as a general pattern in the current developer-tooling
landscape, not specific to LocalStack: "free" and "no signup required"
have become two separate claims, and increasingly, tools guarantee only
the first.

**Finding 2 — compute (real Kubernetes/EKS emulation) is a $89/month
Ultimate-tier feature; lightweight AWS services (IAM, Secrets Manager,
S3, ...) are free.** Confirmed directly from LocalStack's own EKS docs
page: "Ultimate plan required with limited support. Free/Base/Pro tiers
are not supported" — for even the most basic `CreateCluster` API call.
This is a real, principled distinction in what's cheap versus expensive
to emulate: services that are essentially "store a JSON blob, evaluate a
rule, retrieve a value" (IAM's policy documents, Secrets Manager's
key-value pairs) are naturally emulatable with a small amount of code.
Services that need to *actually run your compute* (EKS provisioning a
real, working Kubernetes control plane plus worker nodes) require
LocalStack to stand up genuinely substantial infrastructure of its own
(it uses k3s under the hood) — and that's exactly the capability gated
behind the highest paid tier. **The general lesson: when evaluating any
"cloud emulator" tool, separate its claims about API-shaped storage/
config services from its claims about compute — the former is usually
cheap to build and often free; the latter is usually the whole product's
actual value proposition, and priced accordingly.**

**Finding 3 — policy CRUD is emulated; policy *evaluation* is not,
reliably.** This is the subtlest and most consequential finding, and it
surfaced only by actually trying to use the feature, not by reading
documentation. `iam simulate-custom-policy` fails outright: "Sorry, the
SimulateCustomPolicy operation on the iam service is not currently
supported by LocalStack." `iam simulate-principal-policy` is worse in a
specific way — it does *not* error. It returns a normal-looking
response, `explicitDeny`, for every single input tried: the correct
resource with the correct action, an unrelated resource, a write action
the policy never granted — all `explicitDeny`, unconditionally. **A
tool that fails loudly is a inconvenience; a tool that succeeds
silently while returning a wrong answer is a trap** — if this project
had trusted the first "explicitDeny" result at face value without
testing a case that should have returned "allowed," it would have
concluded the policy was broken when it was actually correct. The fix
was to test both the expected-allow and expected-deny cases together,
specifically so an unconditional-deny bug couldn't hide behind a
plausible-looking result.

## System design approach — validating what simulation can't

Given policy evaluation can't be trusted, the actual verification had to
be split into two independent halves that each prove something real:

```bash
# Part 1: LocalStack's IAM accepts the policy as syntactically valid —
# a genuine test, since a malformed policy document is rejected outright
# by create-policy, the same way real AWS IAM would reject it.
awslocal iam create-policy --policy-name api-secrets-access-policy \
  --policy-document file://api-secrets-access-policy.json

# Part 2: structural checks on the parsed JSON — the *semantic*
# properties simulation would otherwise verify (exactly one read-only
# action, no bare "*" resource) proven directly instead.
```

The structural check isn't a lesser substitute chosen out of
convenience — it's arguably *more* legible than a simulation result
would have been. A simulation returns "allowed" or "denied" for one
specific input at a time; a structural assertion like "the `Action` field
is exactly `secretsmanager:GetSecretValue`, nothing broader" states the
actual invariant being protected directly, in one line, and a reviewer
reading the check understands immediately *why* it exists. The
verification script proves both directions explicitly — that the policy
grants access to `interview-insights/email-hash-secret` and
`interview-insights/database-url`, and that it does *not* grant access to
an unrelated secret name or to any write/delete action — confirmed by
deliberately running the script against a broken (`Resource: "*"`)
version of the policy first, to prove the checks actually fail when they
should, not just that they pass on the happy path.

## System design approach — SecretsProvider and the DI pattern for swappable clients

`SecretsProvider` follows the exact dependency-injection shape this
project already established for `CompanySearchService`/
`ReviewSearchService`'s OpenSearch client (`OPENSEARCH_CLIENT`, a custom
provider token) — the same pattern applied to a new AWS SDK client
instead of an OpenSearch one:

```typescript
// secrets-manager-client.provider.ts
export const SECRETS_MANAGER_CLIENT = 'SECRETS_MANAGER_CLIENT';

export const secretsManagerClientProvider: Provider = {
  provide: SECRETS_MANAGER_CLIENT,
  useFactory: () =>
    new SecretsManagerClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
      ...(process.env.AWS_ENDPOINT_URL
        ? { endpoint: process.env.AWS_ENDPOINT_URL, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } }
        : {}),
    }),
};

// secrets-provider.ts
@Injectable()
export class SecretsProvider {
  constructor(@Inject(SECRETS_MANAGER_CLIENT) private readonly client: SecretsManagerClient) {}

  async getSecret(secretId: string): Promise<string> {
    const response = await this.client.send(new GetSecretValueCommand({ SecretId: secretId }));
    if (!response.SecretString) throw new Error(`Secret "${secretId}" has no SecretString value.`);
    return response.SecretString;
  }
}
```

The payoff of this pattern is immediate and identical to why it was
worth adopting for OpenSearch: the unit test swaps in a plain mock
object for `SECRETS_MANAGER_CLIENT` (`{ send: jest.fn() }`) via NestJS's
testing module, with zero `jest.mock()` module-hoisting gymnastics —
and the *same* class, unmodified, gets constructed with a real
`SecretsManagerClient` pointed at LocalStack for the e2e test. One
implementation, two completely different test doubles, because the
dependency is injected rather than constructed inline.

## The "not wired into anything" boundary, made structurally real

The single most important property of this issue's code isn't what it
does — it's what it deliberately doesn't touch. `SecretsModule` is never
imported by `AppModule`. No controller, service, or bootstrap file
anywhere in `api` references `SecretsProvider`. This isn't a comment
promising restraint — it's a structural fact checkable by grepping the
codebase: nothing outside `SecretsProvider`'s own tests constructs or
injects it. `EMAIL_HASH_SECRET` and `DATABASE_URL` are read from plain
environment variables in every environment this project actually runs
in (native dev, Docker Compose, Kubernetes) — exactly as before this
issue, unchanged in every file except the two new ones that only test
`SecretsProvider` itself.

This distinction — proving new integration code works, without it being
reachable from any real request path — is also why the e2e test was
deliberately *not* added to CI. Doing so would have required storing a
personal LocalStack account's auth token as a GitHub Actions secret,
which is a real, ongoing security/maintenance surface (a credential to
rotate, a new thing a compromised workflow could exfiltrate) — for a
test that, by design, nothing in production depends on passing. The test
still runs for real, just locally and opt-in
(`AWS_ENDPOINT_URL=http://localhost:4566 npm run test:e2e`), skipping
gracefully with a clear message when that variable isn't set, so it
never becomes an unexpected failure for a developer who hasn't set up
LocalStack. **The general lesson: not every real, valuable test belongs
in the same CI tier — a test's value and its blast radius if
mis-configured are two separate questions, and "opt-in, local-only" is a
legitimate answer for tests whose only purpose is proving code ready for
a future that hasn't arrived yet.**

## Step-by-step: what actually got built

1. **Hit the auth-token requirement immediately** on first `docker
   compose --profile localstack up` — diagnosed via the container's own
   crash logs ("License activation failed"), not assumed.
2. **Confirmed the exact scope of the requirement** by reading
   LocalStack's own 2026 pricing/packaging announcement directly, rather
   than guessing at a workaround.
3. **Set up `LOCALSTACK_AUTH_TOKEN`** — found a second, more subtle
   issue along the way: setting it in `~/.zshrc` alone wasn't enough,
   since that file is only sourced for *interactive* shells, and
   scripted/tool-driven shell invocations don't pick it up; copying the
   same export line into `~/.zshenv` (sourced by every zsh invocation,
   interactive or not) fixed it. A third issue surfaced right after:
   `docker compose` doesn't forward host environment variables into a
   container automatically — the compose file needed an explicit
   `${LOCALSTACK_AUTH_TOKEN:?...}` reference, which also gives a clear
   failure message instead of a repeat of the same silent crash-loop if
   the variable is ever missing again.
4. **Wrote `infra/aws/api-secrets-access-policy.json`**, scoped to
   exactly `secretsmanager:GetSecretValue` on two named secrets.
5. **Attempted `simulate-principal-policy`**, got a suspicious
   unconditional `explicitDeny`, and specifically tested both an
   expected-allow and an expected-deny case side by side to confirm it
   wasn't evaluating anything — rather than accepting the first
   plausible-looking result.
6. **Tried `simulate-custom-policy`** as a second approach — found it
   explicitly unsupported by LocalStack.
7. **Rewrote the verification around what's actually reliable**: a real
   `create-policy` call (syntax) plus a structural assertion script
   (semantics) — confirmed the structural checks genuinely catch a
   broken policy by deliberately running them against a `Resource: "*"`
   test policy first.
8. **Built `SecretsProvider`** using the DI-with-provider-token pattern
   already established for `OPENSEARCH_CLIENT`, with a mocked unit test
   and a real LocalStack-backed e2e test, the latter skipping gracefully
   when `AWS_ENDPOINT_URL` isn't set.
9. **Deliberately left CI unchanged** — no LocalStack service container,
   no `LOCALSTACK_AUTH_TOKEN` secret — to avoid taking on a real ongoing
   credential-management surface for practice code with no production
   consumer.
10. **Ran the full existing `api` suite (121 unit tests, 10 e2e suites)**
    to confirm zero regression from any of the above.

## What this enabled

The `SecretsProvider`/`secretsManagerClientProvider` pair is ready to be
wired into `AppModule` the day a real Phase 8b trigger fires — swapping
`process.env.EMAIL_HASH_SECRET` for `secretsProvider.getSecret(...)`
becomes a small, already-tested change rather than a from-scratch
integration effort. The IAM policy JSON is ready to be applied against a
real AWS (or OCI-equivalent) account with the same confidence it's
correctly scoped. More broadly, this issue is a case study in a habit
worth carrying into any tool evaluation: test the specific capability
you actually need, with both a case that should succeed and a case that
should fail, before trusting what a tool's documentation — or its
silently-wrong API response — claims it does.
