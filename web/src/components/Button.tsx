import { ButtonHTMLAttributes } from 'react';

// One consistent primary-action style across every form in the app
// (GitHub issue #60) — previously every page repeated its own
// bg-black/dark:bg-white classes independently.
export function Button({
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-md bg-indigo-600 px-3 py-1 text-sm text-white transition-colors hover:bg-indigo-700 ${className}`}
    />
  );
}
