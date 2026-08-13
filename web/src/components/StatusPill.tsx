import { Check, Clock, Flag, X } from 'lucide-react';

export type PillTone = 'good' | 'warning' | 'serious' | 'critical';

const TONE_ICON: Record<PillTone, typeof Check> = {
  good: Check,
  warning: Clock,
  serious: Flag,
  critical: X,
};

interface StatusPillProps {
  tone: PillTone;
  children: React.ReactNode;
}

// GitHub issue #620 — the reserved four-color status vocabulary
// (docs/DECISIONS.md D100's --status-good/warning/serious/critical
// tokens, defined in #612, unused until now) as a real component:
// icon + label, never color alone, and text uses each tone's `-ink`
// variant rather than the raw hue — the raw warning/serious hexes
// measure 1.79/2.57:1 on a light surface (dataviz skill's own
// palette reference), which fails as text color outright.
export function StatusPill({ tone, children }: StatusPillProps) {
  const Icon = TONE_ICON[tone];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: `color-mix(in oklab, var(--status-${tone}) 16%, transparent)`,
        color: `var(--status-${tone}-ink)`,
      }}
    >
      <Icon aria-hidden="true" className="h-3 w-3" />
      {children}
    </span>
  );
}
