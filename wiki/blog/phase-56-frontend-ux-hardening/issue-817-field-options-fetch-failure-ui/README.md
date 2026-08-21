# Phase 56, Issue #817 — Failed Round-Type Field-Options Fetch Silently Drops Fields

*Part of Phase 56 — Frontend & UX Hardening.
See `docs/ROADMAP.md` Phase 56.*

## The gap

`write-review/page.tsx` fetches the round-type registry once, on mount,
to know which type-specific fields to render for each round type
(#248). If that fetch failed — a network blip, a transient API error —
the round step form ended up with an empty fields list, which renders
*identically* to a round type that genuinely has no type-specific
fields at all. A candidate hitting this had no way to tell "this round
type has nothing to fill in" from "the app failed to load what you were
supposed to fill in" — they'd submit a round missing detail it should
have had, with zero indication anything went wrong.

## The fix: an explicit failure state, distinguishable from "genuinely empty," with a retry

```ts
// write-review/page.tsx
const [fieldOptionsFailed, setFieldOptionsFailed] = useState(false);

function loadFieldOptions() {
  setFieldOptionsFailed(false);
  api
    .getRoundTypeFieldOptions()
    .then(setFieldOptions)
    .catch((err: unknown) => {
      setError(errorMessage(err));
      setFieldOptionsFailed(true);
    });
}

useEffect(() => {
  loadFieldOptions();
}, []);
```

`loadFieldOptions` is a named function, not an inline `useEffect`
callback, specifically so it can be handed to the retry button as-is —
the same fetch-and-set-state logic runs whether it's triggered by the
initial mount or an explicit retry click, with no duplicated code
between the two:

```tsx
{/* GitHub issue #817 (Phase 56) — a failed field-options fetch used
    to silently drop this whole section with no indication why
    (fields.length === 0 either way, same as a round type that
    genuinely has no type_metadata fields). Flag it explicitly
    instead, with a retry, rather than letting the candidate submit
    unaware that round-type-specific detail never had a chance to
    render. */}
{fieldOptionsFailed && (
  <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950">
    <p className="text-amber-900 dark:text-amber-200">
      Round-specific details couldn&apos;t load, so they aren&apos;t shown for this round. Your
      other answers are unaffected.
    </p>
    {onRetryFieldOptions && (
      <Button type="button" variant="neutral" onClick={onRetryFieldOptions} className="self-start">
        Retry
      </Button>
    )}
  </div>
)}
```

The copy is deliberately reassuring rather than alarming — "your other
answers are unaffected" — since a candidate mid-wizard seeing an amber
warning box could otherwise reasonably wonder if they're about to lose
everything they've already filled in.

## Verification

A new component spec
(`wizard-round-step-field-options-failure.spec.tsx`) covers both states
directly: the warning renders when `fieldOptionsFailed` is true and not
when it's false, and clicking Retry calls `onRetryFieldOptions` — proving
the retry wiring actually re-triggers the fetch, not just that the
button renders.
