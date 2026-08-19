# Phase 46, Issue #658 — Decide the Pilot's Public Domain and Create DNS Records

*Part of Phase 46 — Hetzner Pilot: Reachability & Operational Hardening.
See `docs/ROADMAP.md` Phase 46, Track A.*

## The gap this closed

Every other Phase 46 issue depended on this one existing first: TLS
issuance (#662) needs a real hostname to prove domain ownership against;
`overlays/hetzner-pilot`'s Ingress (#646) needs real hostnames to route
on; `MAIL_FROM_ADDRESS` (#655) needs a real domain to send from. Before
this issue, the pilot VM was just a bare IP address.

## A real name collision, caught before registering anything

The obvious name — some variation of "Interview Insights," this
project's own product name — turned out to already be a live, active,
unrelated SaaS business (an AI interview-coaching platform) at
`interview-insights.com`. Registering any close variant, even on a
different TLD, would have risked genuine visitor confusion and looked
like deliberately riding an existing brand — worth catching before
spending money, not after.

The eventual choice, `interviewinsights.fyi`, follows a different
naming pattern instead — short, data-focused, `.fyi`-suffixed, the same
shape as sites like `levels.fyi`/`onsites.fyi` — deliberately not
reusing "Interview Insights" as a brand name at all, sidestepping the
collision entirely rather than trying to differentiate a near-identical
name.

## Registrar: Cloudflare, for the API this project would need later

Cloudflare Registrar sells at cost (no markup) and automatically puts a
newly-registered domain on Cloudflare's own DNS, which has a real,
scriptable API — not a requirement for *this* issue specifically, but
one that paid off immediately for making the actual DNS records
reproducible rather than a one-off manual dashboard click.

## DNS records: `app.`/`api.`, unproxied, pointing straight at the VM

`infra/k8s/base/07-ingress.yaml`'s host-based routing expects exactly
two hostnames — `app.<domain>` for `web`, `api.<domain>` for `api`.
Both created as plain A records via Cloudflare's API, `proxied: false`:

```bash
BODY=$(jq -n --arg name "$HOST" --arg ip "$VM_IP" \
  '{type: "A", name: $name, content: $ip, ttl: 1, proxied: false}')
curl -X POST -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
  -d "$BODY" "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records"
```

Deliberately *not* proxied through Cloudflare's own CDN/edge — #662's
cert-manager needs to reach the real origin directly for its HTTP-01
challenge, and proxying would put Cloudflare's own edge TLS in front of
that instead of the pilot's own Let's Encrypt certificate, defeating
the point of a pilot meant to prove out real origin reachability.

## `CLOUDFLARE_API_TOKEN`: a provisioning credential, not an app secret

Documented in `docs/SECRETS.md` as its own category, distinct from
every Pattern A/B secret a pod actually reads — no pod ever touches
this token, it's used purely to manage DNS records, the same category
as `HCLOUD_TOKEN`. Scoped narrowly via Cloudflare's "Edit zone DNS"
token template, restricted to just this one zone.

## Verification

Not trusted from the Cloudflare API's own "success" response alone —
verified via a real DNS query against two independent public resolvers:

```bash
dig @1.1.1.1 +short A app.interviewinsights.fyi
dig @8.8.8.8 +short A app.interviewinsights.fyi
```

Both returned the pilot's real IP. A first attempt returned nothing —
genuine propagation lag inside Cloudflare's own network, not a
configuration bug — resolved cleanly on retry a minute later.
