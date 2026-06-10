"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

type Note = {
  id: string;
  created_at: string;
  agent: string | null;
  message: string;
  urgency: string;
  read_at: string | null;
  work_item_id: string | null;
  link_url: string | null;
};

/** Strip all HTML tags so agent messages render as plain text. */
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

const PANEL_W = 320; // w-80
const PANEL_MAX_H = 384; // max-h-96
const GAP = 8;

export default function NotificationBell() {
  const router               = useRouter();
  const [notes, setNotes]   = useState<Note[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen]     = useState(false);
  const [pos, setPos]       = useState<{ left: number; top: number } | null>(null);
  const btnRef              = useRef<HTMLButtonElement>(null);
  const panelRef            = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/notifications");
      if (!r.ok) return;
      const j = await r.json();
      setNotes(j.notifications ?? []);
      setUnread(j.unread ?? 0);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  // Compute a viewport-clamped fixed position from the bell's rect. The bell
  // lives in the sidebar footer (bottom-left) whose container is overflow-hidden,
  // so the panel must be portalled to <body> and positioned with `fixed`.
  const computePos = useCallback(() => {
    const b = btnRef.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    // Horizontal: align panel's left edge to the bell, clamped on screen.
    let left = Math.min(r.left, window.innerWidth - PANEL_W - GAP);
    if (left < GAP) left = GAP;
    // Vertical: open below if there's room, otherwise above the bell.
    let top = r.bottom + 4;
    if (top + PANEL_MAX_H > window.innerHeight - GAP) {
      top = Math.max(GAP, r.top - PANEL_MAX_H - 4);
    }
    setPos({ left, top });
  }, []);

  const toggle = () => {
    if (!open) computePos();
    setOpen((o) => !o);
  };

  // Close on outside click (button OR panel), and reposition on resize/scroll.
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onReflow() {
      computePos();
    }
    document.addEventListener("mousedown", onClickOutside);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, computePos]);

  const markRead = async (id: string, work_item_id: string | null, link_url: string | null) => {
    await fetch(`/api/notifications/${id}`, { method: "PATCH" });
    load();
    const dest = work_item_id ? `/work/${work_item_id}` : link_url;
    if (dest) {
      setOpen(false);
      router.push(dest);
    }
  };

  const panel = open && pos && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", left: pos.left, top: pos.top, width: PANEL_W }}
          className="max-h-96 overflow-y-auto bg-white border border-brand-border rounded-lg shadow-lg z-[1000]"
        >
          <div className="px-3 py-2 border-b border-brand-border sticky top-0 bg-white">
            <p className="text-xs font-semibold text-brand-black uppercase tracking-wide">
              Notifications
            </p>
          </div>

          {notes.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-brand-muted">
              No notifications
            </div>
          )}

          {notes.map((n) => (
            <div
              key={n.id}
              onClick={() => n.read_at === null && markRead(n.id, n.work_item_id, n.link_url)}
              className={`px-3 py-2.5 border-b border-brand-border last:border-b-0 transition-colors
                ${n.read_at === null ? "cursor-pointer hover:bg-orange-50" : "opacity-50"}
                ${n.urgency === "high" && n.read_at === null ? "bg-red-50 hover:bg-red-50" : ""}
              `}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[10px] text-brand-muted font-medium">
                  {n.agent ?? "system"}
                </span>
                {n.urgency === "high" && n.read_at === null && (
                  <span className="text-[10px] font-semibold text-red-600 uppercase">urgent</span>
                )}
                {n.read_at === null && n.urgency !== "high" && (
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-orange flex-shrink-0" />
                )}
                <span className="text-[10px] text-brand-muted ml-auto">
                  {new Date(n.created_at).toLocaleString(undefined, {
                    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                  })}
                </span>
              </div>
              <div className="text-sm text-brand-black">{stripTags(n.message)}</div>
            </div>
          ))}
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={toggle}
        aria-label="Notifications"
        className="p-1.5 rounded-md text-brand-muted hover:bg-brand-offwhite hover:text-brand-black transition-colors relative"
      >
        {/* Bell icon */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 rounded-full
                           bg-brand-orange text-white text-[10px] font-semibold leading-4 text-center">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {panel}
    </div>
  );
}
