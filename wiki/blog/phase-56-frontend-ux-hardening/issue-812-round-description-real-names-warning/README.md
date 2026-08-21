# Phase 56, Issue #812 — Round Title/Description Have No "Don't Include Real Names" Warning

*Part of Phase 56 — Frontend & UX Hardening.
See `docs/ROADMAP.md` Phase 56.*

## The gap

The recruiter-identifier field in the wizard already carries a caption
nudging candidates away from typing an interviewer's real name — but
`Round.title`/`Round.description` had no equivalent warning, despite
being exactly the kind of free text a candidate might casually name
after who ran the round ("Sarah's system design round"). The stakes
here are higher than they look at first glance: per #775 (Phase 52),
`Round` isn't even moderation-gated — it was never in scope for
`moderation_queue` review the way `RoundRating`'s free text is. A real
name typed into a round description reaches a public process page with
zero human review standing between the candidate and CLAUDE.md hard
constraint #1.

## The fix: the same caption pattern, on the field that needs it most

```tsx
<label className="flex flex-col text-sm">
  Description (optional)
  <textarea /* ... */ />
  {/* GitHub issue #812 (Phase 56) — this content is shown publicly
      and, unlike a rating's freeText, isn't moderation-gated at all
      (see the sibling security-phase issue #775), so the nudge
      against real names matters here even more than on the
      recruiter-identifier field above. */}
  <span className="text-xs text-gray-500">
    Please don&apos;t include interviewer names here — describe the round itself, not who ran it.
  </span>
</label>
```

A caption, not a hard block — this app already relies on nudges over
enforcement for candidate-authored free text elsewhere (there's no
practical way to reliably detect a name in arbitrary text), so
consistency with the existing recruiter-identifier pattern was the
right call here too. The comment explicitly cross-references #775 so a
future reader understands *why* this field's nudge carries more weight
than a typical "please be nice" caption would.

## Verification

Visual/manual verification in a real browser — this is copy and layout,
not logic, so there's no meaningful unit assertion beyond confirming the
caption renders. Existing wizard e2e/component tests continued to pass
unchanged, confirming the addition didn't disturb the surrounding form's
behavior.
