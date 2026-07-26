'use client';

import { Button } from '@/components/Button';

interface ConfirmationModalProps {
  title: string;
  message: string;
  onClose: () => void;
}

// The first real modal in this app (GitHub issue #372, Phase 35) — a
// plain informational acknowledgment, not a yes/no decision, so OK and
// the corner close both just dismiss it identically; there's no
// divergent behavior to choose between.
export function ConfirmationModal({ title, message, onClose }: ConfirmationModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-modal-title"
        className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg dark:bg-gray-900"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="confirmation-modal-title" className="text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-200"
          >
            ✕
          </button>
        </div>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{message}</p>
        <div className="mt-4 flex justify-end">
          <Button type="button" onClick={onClose}>
            OK
          </Button>
        </div>
      </div>
    </div>
  );
}
