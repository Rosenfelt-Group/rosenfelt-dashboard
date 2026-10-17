"use client";
import { useRef, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";

const MAX = 1000;

// Per-deliverable welcome message. Plain text; the room shows it as text with line breaks kept.
export function WelcomeEditor({ deliverableId, initial, onSaved }: {
  deliverableId: string; initial: string | null; onSaved: (msg: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(initial ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const save = async (value: string | null) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setErr(null);
    try {
      const r = await fetchJson<{ welcome_message: string | null }>(`/api/deliverables/${deliverableId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ welcome_message: value }),
      });
      if (!r.ok) { setErr(r.error); return; }
      setText(r.data.welcome_message ?? "");
      setEditing(false);
      onSaved(r.data.welcome_message ? "Welcome message saved." : "Welcome message removed.");
    } finally { inFlight.current = false; setBusy(false); }
  };

  if (!editing) {
    return (
      <div className="mb-2 text-sm">
        {text
          ? <p className="whitespace-pre-line text-brand-black border-l-2 border-brand-border pl-2">{text}</p>
          : <p className="text-brand-muted">No welcome message (the room shows its default greeting).</p>}
        <button onClick={() => setEditing(true)} className="text-xs text-brand-orange">{text ? "Edit welcome message" : "Add welcome message"}</button>
      </div>
    );
  }
  return (
    <div className="mb-2 space-y-1 text-sm">
      <textarea value={text} onChange={e => setText(e.target.value)} rows={4} maxLength={MAX}
        placeholder="Shown to visitors above this deliverable. Plain text; line breaks are kept."
        className="w-full border border-brand-border rounded px-2 py-1.5" />
      <div className="flex items-center gap-2">
        <span className="text-xs text-brand-muted">{text.length}/{MAX}</span>
        <button disabled={busy} onClick={() => save(text)} className="px-2 py-1 rounded bg-brand-orange text-white disabled:opacity-50">Save</button>
        {initial && <button disabled={busy} onClick={() => save(null)} className="px-2 py-1 rounded border border-brand-border disabled:opacity-50">Remove</button>}
        <button disabled={busy} onClick={() => { setText(initial ?? ""); setEditing(false); }} className="px-2 py-1 rounded border border-brand-border disabled:opacity-50">Cancel</button>
      </div>
      {err && <p className="text-red-600">{err}</p>}
    </div>
  );
}
