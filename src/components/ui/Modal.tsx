"use client";

import { useEffect, useId, useRef } from "react";
import clsx from "clsx";

const SIZES = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
  "2xl": "max-w-4xl",
} as const;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  /** Right-aligned action row under the body (e.g. Cancel / Save buttons). */
  footer?: React.ReactNode;
  size?: keyof typeof SIZES;
  /** Close when the dimmed backdrop is clicked. Off by default so a stray
   * click doesn't throw away a half-filled form. */
  closeOnBackdrop?: boolean;
  /** Extra classes for the panel (e.g. a custom padding). */
  className?: string;
  /** Block Escape and the ✕ button, e.g. while a save is in flight. */
  preventClose?: boolean;
};

/**
 * Dialog with a dimmed backdrop. On small screens it docks to the bottom as a
 * sheet. Escape closes it, focus moves into it on open, Tab stays inside it,
 * and focus returns to the opener on close.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
  closeOnBackdrop = false,
  className,
  preventClose = false,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const preventCloseRef = useRef(preventClose);
  preventCloseRef.current = preventClose;

  // Remember what had focus when the modal opened, so it can get it back on
  // close. Read during render: by the time effects run, a child with
  // autoFocus has already moved focus into the modal.
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  if (open && !wasOpenRef.current && typeof document !== "undefined") {
    openerRef.current = document.activeElement as HTMLElement | null;
  }
  wasOpenRef.current = open;

  useEffect(() => {
    if (!open) return;
    const opener = openerRef.current;
    const panel = panelRef.current;
    // A child with autoFocus has already taken focus by now (child effects run
    // first); keep it. Otherwise focus the first field, skipping the ✕ button.
    if (!panel?.contains(document.activeElement)) {
      const first = panel?.querySelector<HTMLElement>(`[data-modal-body] :is(${FOCUSABLE})`);
      (first ?? panel)?.focus();
    }

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (!preventCloseRef.current) onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-end md:items-center justify-center p-4"
      onMouseDown={closeOnBackdrop ? (e => { if (e.target === e.currentTarget && !preventClose) onClose(); }) : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={clsx(
          "bg-white rounded-xl w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto focus:outline-none",
          SIZES[size],
          className,
        )}
      >
        <div className="flex items-center justify-between gap-4 mb-5">
          <h2 id={titleId} className="text-base font-semibold text-brand-black">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={preventClose}
            aria-label="Close"
            className="text-brand-muted hover:text-brand-black text-lg leading-none disabled:opacity-40"
          >
            ✕
          </button>
        </div>
        <div data-modal-body>
          {children}
          {footer && <div className="flex justify-end gap-2 mt-6">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
