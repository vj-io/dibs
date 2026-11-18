"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "./cx";
import { Icon } from "./icons";

/**
 * Modal sheet over the page (the join form). Native <dialog>.showModal(): the page behind is inert,
 * focus stays inside, Esc closes. `onClose` fires for Esc, the close button and a tap on the backdrop.
 */
export function BottomSheet({ open, onClose, title, children, dismissible = true, className }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode;
  /** false = no close button, Esc and backdrop do nothing (a required step). */
  dismissible?: boolean; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); if (dismissible) onClose(); }}
      onClick={(e) => { if (dismissible && e.target === e.currentTarget) onClose(); }}
      className={cx(
        "m-0 mt-auto max-h-[92dvh] w-full max-w-none bg-transparent p-0 text-ink backdrop:bg-[rgb(10_10_10/0.45)]",
        "sm:m-auto sm:max-w-md",
        className,
      )}
    >
      {open && (
        <div className="sheet-in mx-auto w-full max-w-lg rounded-t-[28px_18px] border-[2.5px] border-b-0 border-ink bg-card px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 sm:rounded-wobble sm:border-b-[2.5px] sm:shadow-ink-lg">
          <div aria-hidden="true" className="mx-auto mb-3 h-1.5 w-12 rounded-pill bg-ink/25 sm:hidden" />
          <div className="mb-4 flex items-start gap-3">
            <h2 id={titleId} className="flex-1 pt-2 text-2xl">{title}</h2>
            {dismissible && (
              <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 grid size-12 place-items-center rounded-full">
                <Icon name="cross" size={22} />
              </button>
            )}
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
