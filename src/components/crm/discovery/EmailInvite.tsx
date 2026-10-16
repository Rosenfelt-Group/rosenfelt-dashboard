"use client";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { INPUT } from "./QuestionForm";

// Whether the app can send email. null while loading; email controls stay hidden until it's true.
export function useEmailConfigured(): boolean | null {
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/email/status").then(r => r.json()).then(d => setConfigured(Boolean(d?.configured))).catch(() => setConfigured(false));
  }, []);
  return configured;
}

export function RecipientFields({ to, firstName, onChange }: {
  to: string; firstName: string; onChange: (v: { to: string; firstName: string }) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <input type="email" className={clsx(INPUT, "sm:col-span-2")} placeholder="Recipient email" value={to}
        onChange={e => onChange({ to: e.target.value, firstName })} />
      <input className={INPUT} placeholder="First name (optional)" value={firstName}
        onChange={e => onChange({ to, firstName: e.target.value })} />
    </div>
  );
}

// "Resend email" for an invite that's already been sent: emails the same link again without re-freezing.
export function ResendInviteEmail({ inviteId, defaultTo, defaultFirstName }: { inviteId: string; defaultTo?: string; defaultFirstName?: string }) {
  const configured = useEmailConfigured();
  const [open, setOpen] = useState(false);
  const [r, setR] = useState({ to: defaultTo ?? "", firstName: defaultFirstName ?? "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (!configured) return null;
  if (!open) return <button onClick={() => setOpen(true)} className="btn-ghost text-xs px-3 py-1.5">Resend email</button>;

  async function send() {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/crm/discovery/${inviteId}/email`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: r.to.trim(), firstName: r.firstName.trim() || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: `Emailed to ${r.to.trim()}` } : { ok: false, text: data.error ?? "Could not send" });
  }

  return (
    <div className="w-full space-y-2 pt-2">
      <RecipientFields to={r.to} firstName={r.firstName} onChange={setR} />
      <div className="flex items-center gap-2">
        <button onClick={send} disabled={busy || !r.to.trim()} className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50">
          {busy ? "Sending…" : "Send email"}
        </button>
        <button onClick={() => { setOpen(false); setMsg(null); }} className="btn-ghost text-xs px-3 py-1.5">Cancel</button>
        {msg && <span className={clsx("text-xs", msg.ok ? "text-green-700" : "text-red-600")}>{msg.text}</span>}
      </div>
    </div>
  );
}
