// The page-width decision for the whole app (GitHub issue #60, extended
// by issue #231/Phase 22 with a `size` prop): narrow for forms (the
// default, matching every page's pre-Phase-22 width), wide for
// dashboards/lists where a single 672px column wastes space.
export function PageContainer({
  children,
  size = 'narrow',
}: {
  children: React.ReactNode;
  size?: 'narrow' | 'wide';
}) {
  const maxWidth = size === 'wide' ? 'max-w-4xl' : 'max-w-2xl';
  return <main className={`mx-auto flex ${maxWidth} flex-col gap-8 p-8`}>{children}</main>;
}
