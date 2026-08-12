'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
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
//
// Built on Radix's Dialog primitive (GitHub issue #615) rather than
// hand-rolled markup — focus trap, ESC-to-close, click-outside-to-close,
// and the dialog/labelledby ARIA wiring all come from Radix instead of
// being reimplemented (and previously, not implemented at all: the
// hand-rolled version had none of the first three). `open` is always
// `true` — the parent already controls mounting via conditional
// rendering, so there's no separate trigger; `onOpenChange` routes every
// close path (OK, the X, ESC, overlay click) through the same `onClose`.
export function ConfirmationModal({ title, message, onClose }: ConfirmationModalProps) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-6 shadow-lg dark:bg-gray-900">
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            {message}
          </Dialog.Description>
          <div className="mt-4 flex justify-end">
            <Dialog.Close asChild>
              <Button type="button">OK</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
