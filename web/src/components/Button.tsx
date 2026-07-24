import { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'danger' | 'neutral' | 'warning';

// Named variants (GitHub issue #236, Phase 23) — previously every
// destructive/secondary/caution action (delete, reject, cancel, log
// out, flag) repeated the identical bg-red-600/bg-gray-600/bg-amber-600
// override independently across me/page.tsx and moderation/page.tsx.
// No new brand color here — this formalizes colors already in use, it
// doesn't introduce one.
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-indigo-600 hover:bg-indigo-700 focus-visible:ring-indigo-500',
  danger: 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-500',
  neutral: 'bg-gray-600 hover:bg-gray-700 focus-visible:ring-gray-500',
  warning: 'bg-amber-600 hover:bg-amber-700 focus-visible:ring-amber-500',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

// One consistent action style across every form in the app (GitHub
// issue #60) — previously every page repeated its own bg-black/dark:bg-white
// classes independently.
export function Button({ className = '', variant = 'primary', ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`rounded-md px-3 py-1 text-sm text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900 ${VARIANT_CLASSES[variant]} ${className}`}
    />
  );
}
