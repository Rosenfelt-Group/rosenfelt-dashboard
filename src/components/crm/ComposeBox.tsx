"use client";
import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui";

export type ComposePrefill = { to: string[]; subject: string; reply_to_email_message_id?: string };

/** Brian's compose box (admin only; the page decides whether to render it). Sends via POST /api/crm/email/send. */
export function ComposeBox({ prefill, onSent }: { prefill: ComposePrefill; onSent: () => void }) {
  const [to, setTo] = useState(prefill.to.join(", "));
  const [subject, setSubject] = useState(prefill.subject);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState(prefill.reply_to_email_message_id);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  // A new prefill (Reply clicked, or the contact loaded) replaces the fields.
  useEffect(() => {
    setTo(prefill.to.join(", "));
    setSubject(prefill.subject);
    setReplyTo(prefill.reply_to_email_message_id);
    setOk(false);
    setError(null);
  }, [prefill]);

  async function send() {
    if (sending) return;
    const list = to.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!list.length || !subject.trim() || !body.trim()) return setError("To, subject and message are required.");
    setSending(true);
    setError(null);
    setOk(false);
    const r = await fetchJson<{ gmail_message_id: string }>("/api/crm/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: list, subject: subject.trim(), body_text: body, ...(replyTo ? { reply_to_email_message_id: replyTo } : {}) }),
    });
    setSending(false);
    if (!r.ok) return setError(r.error);
    setBody("");
    setOk(true);
    onSent();
  }

  return (
    <form className="card space-y-2" onSubmit={(e) => { e.preventDefault(); send(); }} aria-label="Compose email">
      <h2 className="text-sm font-medium text-brand-black">{replyTo ? "Reply" : "Write"}</h2>
      <input className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange" aria-label="To" placeholder="To" value={to} onChange={(e) => setTo(e.target.value)} disabled={sending} />
      <input className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange" aria-label="Subject" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={sending} />
      <textarea className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange min-h-32" aria-label="Message" placeholder="Message" value={body} onChange={(e) => setBody(e.target.value)} disabled={sending} />
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      {ok && <p role="status" className="text-xs text-green-700">Sent.</p>}
      <div className="flex gap-2 items-center">
        <Button type="submit" size="sm" disabled={sending}>{sending ? "Sending…" : "Send"}</Button>
        {replyTo && <Button size="sm" variant="ghost" onClick={() => setReplyTo(undefined)} disabled={sending}>Not a reply</Button>}
      </div>
    </form>
  );
}
