"use client";
import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui";

export type ComposePrefill = { to: string[]; subject: string; reply_to_email_message_id?: string };

export type ComposeRecipient = { name: string; email: string };

const splitList = (v: string) => v.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);

/**
 * Brian's compose box (admin only; the page decides whether to render it). Sends via POST /api/crm/email/send.
 * `people` adds a picker that toggles those addresses in the To field (the organization page uses it).
 */
export function ComposeBox({ prefill, onSent, people }: { prefill: ComposePrefill; onSent: () => void; people?: ComposeRecipient[] }) {
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
    const list = splitList(to);
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
      {people && people.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Recipients">
          <span className="text-xs text-brand-muted">To:</span>
          {people.map((p) => {
            const list = splitList(to);
            const on = list.some((e) => e.toLowerCase() === p.email.toLowerCase());
            return (
              <button key={p.email} type="button" aria-pressed={on} disabled={sending}
                onClick={() => setTo((on ? list.filter((e) => e.toLowerCase() !== p.email.toLowerCase()) : [...list, p.email]).join(", "))}
                className={`text-xs px-2 py-0.5 rounded-full border ${on ? "bg-brand-orange text-white border-brand-orange" : "border-brand-border text-brand-black hover:bg-brand-cream"}`}
                title={p.email}>
                {p.name}
              </button>
            );
          })}
        </div>
      )}
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
