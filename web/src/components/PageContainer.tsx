// The single, deliberate page-width/layout decision for the whole app
// (GitHub issue #60) — previously each page repeated the same wrapper
// classes independently, which happened to match but wasn't enforced.
export function PageContainer({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex max-w-2xl flex-col gap-8 p-8">{children}</main>;
}
