"use client";
import { useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";

// Emails the room invite for a just-issued link from brian@rosably.com. Hidden when the app has no
// email set up; Copy stays available alongside it as the fallback.
export function SendInviteEmail({ engagementId, accessId, link, refreshed, suggestions }: {
  engagementId: string; accessId: string; link: string; refreshed: boolean; suggestions: string[];
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [to, setTo] = useState("");
  const [firstName, setFirstName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    fetchJson<{ configured: boolean }>("/api/email/status").then(r => setConfigured(r.ok && r.data.configured));
  }, []);

  if (!configured) return null;

  const send = async () => {
    if (inFlight.current || !to.trim()) return;
    inFlight.current = true; setBusy(true); setResult(null);
    try {
      const r = await fetchJson<{ logged: boolean }>(`/api/engagements/${engagementId}/access/${accessId}/email`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: to.trim(), link, refreshed, first_name: firstName.trim() || undefined,
          time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      setResult(r.ok
        ? { ok: true, text: `Sent to ${to.trim()}${r.data.logged ? " and logged on the lead" : ""}.` }
        : { ok: false, text: r.error });
    } finally { inFlight.current = false; setBusy(false); }
  };

  return (
    <div className="mt-3 border-t border-amber-200 pt-3 break-normal">
      <p className="font-medium mb-1">Or email the invite from brian@rosably.com</p>
      <div className="flex flex-wrap gap-2">
        <input type="email" value={to} onChange={e => setTo(e.target.value)} placeholder="Recipient email"
          list={`invite-to-${accessId}`} className="border border-brand-border rounded px-2 py-1.5 text-sm flex-1 min-w-48 bg-white" />
        <datalist id={`invite-to-${accessId}`}>{suggestions.map(s => <option key={s} value={s} />)}</datalist>
        <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First name (optional)"
          className="border border-brand-border rounded px-2 py-1.5 text-sm w-44 bg-white" />
        <button disabled={busy || !to.trim()} onClick={send}
          className="px-3 py-1.5 text-sm rounded bg-brand-orange text-white disabled:opacity-50">
          {busy ? "Sending…" : "Send email"}
        </button>
      </div>
      {result && <p className={`mt-1 text-xs ${result.ok ? "text-green-700" : "text-red-600"}`}>{result.text}</p>}
    </div>
  );
}
