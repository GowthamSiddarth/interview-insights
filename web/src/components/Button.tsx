import { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';
import Link from 'next/link';

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

interface ButtonAsButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  href?: undefined;
}

interface ButtonAsLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  variant?: ButtonVariant;
  href: string;
}

type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps;

// One consistent action style across every form in the app (GitHub
// issue #60) — previously every page repeated its own bg-black/dark:bg-white
// classes independently.
//
// GitHub issue #618 — an `href` renders a real <Link> instead of a
// <button>, same visual classes, for actions that are genuinely
// navigation (e.g. a profile page's "Write a review" CTA). A
// <button onClick={() => router.push(...)}> loses right-click/open-
// in-new-tab/status-bar-preview — real regressions for a primary
// navigation action, not just a semantic nitpick.
export function Button({ className = '', variant = 'primary', href, ...props }: ButtonProps) {
  const classes = `rounded-md px-3 py-1 text-sm text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900 ${VARIANT_CLASSES[variant]} ${className}`;

  if (href) {
    return <Link href={href} className={classes} {...(props as AnchorHTMLAttributes<HTMLAnchorElement>)} />;
  }
  return <button {...(props as ButtonHTMLAttributes<HTMLButtonElement>)} className={classes} />;
}
