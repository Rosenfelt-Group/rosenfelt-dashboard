"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui";
import { NEW_ITEMS, type NewKind } from "./palette";

// Loaded on first use, so every CRM page doesn't ship the palette and all the create dialogs.
const CommandPalette = dynamic(() => import("./CommandPalette").then(m => m.CommandPalette), { ssr: false });
const NewRecordModal = dynamic(() => import("./NewRecordModal").then(m => m.NewRecordModal), { ssr: false });

/** The bar above every CRM page: ⌘K search and the + New menu. */
export function CrmToolbar() {
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState<NewKind | null>(null);
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCreating(null);
        setSearching(s => !s);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex items-center gap-2 px-4 md:px-8 py-2.5 bg-white border-b border-brand-border">
      <button
        type="button"
        onClick={() => setSearching(true)}
        aria-label="Search the CRM"
        aria-keyshortcuts="Meta+K Control+K"
        className="flex-1 min-w-0 max-w-md flex items-center gap-2 h-9 px-3 rounded-lg border border-brand-border bg-brand-offwhite text-sm text-brand-muted hover:border-brand-muted transition-colors"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span className="truncate">Search organizations, people, deals…</span>
        <kbd className="hidden sm:inline ml-auto text-[11px] font-sans px-1.5 py-0.5 rounded border border-brand-border bg-white">{isMac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      <NewMenu onPick={setCreating} />
      {searching && <CommandPalette onClose={() => setSearching(false)} onCreate={setCreating} />}
      {creating && <NewRecordModal kind={creating} onClose={() => setCreating(null)} />}
    </div>
  );
}

function NewMenu({ onPick }: { onPick: (kind: NewKind) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function onMenuKey(e: React.KeyboardEvent) {
    const items = itemRefs.current.filter((x): x is HTMLButtonElement => !!x);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    }
  }

  return (
    <div ref={rootRef} className="relative shrink-0 ml-auto">
      <Button
        ref={buttonRef}
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); } }}
        className="h-9"
      >
        + New
      </Button>
      {open && (
        <div role="menu" aria-label="Create" onKeyDown={onMenuKey}
          className="absolute right-0 mt-1 w-72 max-w-[calc(100vw-2rem)] bg-white border border-brand-border rounded-xl shadow-lg p-1 z-40">
          {NEW_ITEMS.map((n, i) => (
            <button
              key={n.kind}
              ref={el => { itemRefs.current[i] = el; }}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); onPick(n.kind); }}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-brand-cream focus:bg-brand-cream focus:outline-none"
            >
              <span className="block text-sm text-brand-black">{n.label}</span>
              <span className="block text-xs text-brand-muted">{n.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
