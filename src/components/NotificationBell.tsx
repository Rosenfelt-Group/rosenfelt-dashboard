"use client";
import { useEffect, useState, useCallback, useRef } from "react";

type Note = {
  id: string;
  created_at: string;
  agent: string | null;
  message: string;
  urgency: string;
  read_at: string | null;
  work_item_id: string | null;
};

/** Strip all HTML tags so agent messages render as plain text. */
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

export default function NotificationBell() {
  const [notes, setNotes]   = useState<Note[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen]     = useState(false);
  const ref                 = useRef<HTMLDivElement>(null);

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

  // Close dropdown on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const markRead = async (id: string) => {
    await fetch(`/api/notifications/${id}`, { method: "PATCH" });
    load();
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
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

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 max-h-96 overflow-y-auto
                        bg-white border border-brand-border rounded-lg shadow-lg z-50">
          <div className="px-3 py-2 border-b border-brand-border">
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
              onClick={() => n.read_at === null && markRead(n.id)}
              className={`px-3 py-2.5 border-b border-brand-border last:border-b-0 transition-colors
                ${n.read_at === null
                  ? "cursor-pointer hover:bg-orange-50"
                  : "opacity-50"
                }
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
              <div className="text-sm text-brand-black">
                {stripTags(n.message)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
