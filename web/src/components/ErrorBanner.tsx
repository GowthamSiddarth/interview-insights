// Shared inline error display — extracted from the wizard (GitHub issue
// #253, Phase 26) since the draft-store-backed wizard now spans several
// colocated files that all need it.
export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
      {message}
    </p>
  );
}
