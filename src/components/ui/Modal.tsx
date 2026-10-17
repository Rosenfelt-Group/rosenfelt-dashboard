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
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
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
      onMouseDown={closeOnBackdrop ? (e => { if (e.target === e.currentTarget) onClose(); }) : undefined}
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
            aria-label="Close"
            className="text-brand-muted hover:text-brand-black text-lg leading-none"
          >
            ✕
          </button>
        </div>
        {children}
        {footer && <div className="flex justify-end gap-2 mt-6">{footer}</div>}
      </div>
    </div>
  );
}
